import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatRequiresMcp, executeRoutedStreamingResponse, inferChatCapability, selectModelRoute, type RoutePlan } from "@/lib/openai/model-router";
import { attemptsFromError, recordModelAttempts } from "@/lib/openai/telemetry";
import { createUsageAttemptLifecycle, UsageControlError, usageControlMessage } from "@/lib/usage-metering";
import { takeReadableStreamChunk } from "@/lib/conversation-stream-pacer";

export const runtime = "nodejs";
const MCP_URL=process.env.STORM_SIGNAL_MCP_URL||"https://mcp.vectoros.co/mcp";
const baseInstructions=`You are Storm Signal, a severe-weather intelligence assistant for roofing and restoration companies. Use the Storm Signal MCP for factual weather questions. Help the user find the signal, rank markets, build field plans, and prepare shareable briefs. Separate evidence from inference. Never present weather evidence as confirmation of property damage, guaranteed opportunity, leads, or revenue. Respond in the user's language with practical, concise, explainable recommendations.`;
type ConversationRecord={id:string;title:string;context:Record<string,unknown>};

function customerActivityForTool(name?:string,status?:"discovering"|"running"|"completed"|"failed"){
  if(status==="discovering")return "Opening Storm Signal evidence…";
  if(status==="failed")return "One evidence check could not be completed…";
  if(status==="completed")return "Organizing what we found…";
  if(!name)return "Checking Storm Signal evidence…";
  if(name==="search_storm_events"||name==="search_tropical_cyclones")return "Checking recent storm reports…";
  if(name==="rank_markets")return "Comparing the strongest areas…";
  if(name==="assess_location"||name==="get_storm_event")return "Reviewing the strongest evidence…";
  if(name==="summarize_storm_activity")return "Organizing the evidence…";
  if(name==="build_field_plan")return "Building the field plan…";
  if(name==="prepare_field_brief")return "Preparing the field brief…";
  return "Checking Storm Signal evidence…";
}

export async function GET(){return NextResponse.json({configured:Boolean(process.env.OPENAI_API_KEY)});}
export async function POST(request:Request){
  const supabase=await createSupabaseClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Sign in to use Storm Signal."},{status:401});
  const {data:membership}=await supabase.from("workspace_members").select("workspace_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(!membership)return NextResponse.json({error:"No authorized workspace was found."},{status:403});
  const {data:entitlement}=await supabase.from("entitlements").select("status,ends_at").eq("workspace_id",membership.workspace_id).order("starts_at",{ascending:false}).limit(1).maybeSingle();
  if(entitlement?.status!=="active"||new Date(entitlement.ends_at).getTime()<=Date.now())return NextResponse.json({error:"Your trial has ended. Choose a plan to continue."},{status:402});
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OpenAI is not configured."},{status:503});
  let runId:string|null=null;
  let routePlan:RoutePlan|null=null;
  try{
    const body=await request.json() as {message?:string;conversationId?:string|null;requestId?:string};
    if(!body.message?.trim())return NextResponse.json({error:"Message is required."},{status:400});
    if(!body.requestId||body.requestId.length<8)return NextResponse.json({error:"A request identifier is required."},{status:400});
    const admin=createAdminClient();
    const requestTime=new Date();
    const {data:workspaceRecord}=await admin.from("workspaces").select("primary_market").eq("id",membership.workspace_id).maybeSingle();
    const primaryMarket=typeof workspaceRecord?.primary_market==="string"?workspaceRecord.primary_market:"not specified";
    const instructions=`${baseInstructions}

Temporal operating rules:
- The authoritative current time for this request is ${requestTime.toISOString()} (UTC).
- The user's primary market is ${primaryMarket}. For a named location, use that location's civil timezone when displaying local dates and times; account for daylight saving time and note a timezone only when it helps interpretation.
- Resolve relative periods such as "last 48 hours", "today", "yesterday", "this week", "recent", and "right now" automatically from the authoritative current time. Do not ask the user for an "as of" date or timezone when a relative period is anchored to now.
- For "last 48 hours", search the rolling 48-hour interval ending at the authoritative current time and pass the appropriate start/end or as-of values to the MCP tools.
- Ask for a date only when the user explicitly wants a historical snapshot or gives a genuinely ambiguous historical period that cannot be resolved from the conversation.
- Never substitute an example date for the authoritative current time.`;
    const cleanTitle=body.message.trim().length>72?`${body.message.trim().slice(0,69).trim()}…`:body.message.trim();
    const {data:existingRun}=await admin.from("execution_runs").select("id").eq("workspace_id",membership.workspace_id).eq("idempotency_key",body.requestId).maybeSingle();
    if(existingRun)return NextResponse.json({error:"That request is already being processed."},{status:409});
    let conversation:ConversationRecord|null=null;
    if(body.conversationId){
      const {data}=await supabase.from("conversations").select("id,title,context").eq("id",body.conversationId).eq("workspace_id",membership.workspace_id).maybeSingle();
      conversation=data as ConversationRecord|null;
      if(!conversation)return NextResponse.json({error:"That search could not be found."},{status:404});
      if(conversation.title==="New investigation"||conversation.title==="New search"){
        await admin.from("conversations").update({title:cleanTitle,updated_at:new Date().toISOString()}).eq("id",conversation.id).eq("workspace_id",membership.workspace_id);
        conversation.title=cleanTitle;
      }
    }else{
      const {data,error}=await admin.from("conversations").insert({workspace_id:membership.workspace_id,created_by:user.id,title:cleanTitle,status:"active",context:{}}).select("id,title,context").single();
      if(error)throw error;
      conversation=data as ConversationRecord;
    }
    const {data:contextMessages}=await admin.from("messages").select("content").eq("conversation_id",conversation.id).order("created_at",{ascending:false}).limit(60);
    const contextCharacters=(contextMessages||[]).reduce((total,message)=>total+(typeof message.content?.text==="string"?message.content.text.length:0),0);
    const previousResponseId=typeof conversation.context?.openai_response_id==="string"?conversation.context.openai_response_id:undefined;
    const capability=inferChatCapability(body.message.trim());
    routePlan=selectModelRoute({
      capability,input:body.message.trim(),contextCharacters,requiresMcp:chatRequiresMcp(body.message.trim(),capability,Boolean(previousResponseId)),
      risk:/\b(warning|emergency|evacuat|safety|deploy|field plan|brief|report)\b/i.test(body.message)?"high":capability==="weather_chat"||capability==="comparison"?"medium":"low",
      maxCostCents:Math.max(1,Number(process.env.OPENAI_MAX_REQUEST_COST_CENTS||25)),
    });
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const encoder=new TextEncoder();
    const upstreamAbort=new AbortController();
    request.signal.addEventListener("abort",()=>upstreamAbort.abort(),{once:true});
    const stream=new ReadableStream<Uint8Array>({
      start(controller){
        let open=true;
        const emit=(event:Record<string,unknown>)=>{if(open)try{controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));}catch{open=false;}};
        void (async()=>{
          let responseText="";
          let displayBuffer="";
          let responseId:string|undefined;
          let tools:string[]=[];
          const usageLifecycle=createUsageAttemptLifecycle({
            admin,userId:user.id,workspaceId:membership.workspace_id,conversationId:conversation.id,requestId:body.requestId!,operation:"weather_conversation",
            onExecutionStarted:async(executionRunId)=>{
              runId=executionRunId;
              const {error}=await admin.from("messages").insert({workspace_id:membership.workspace_id,conversation_id:conversation.id,role:"user",content:{text:body.message!.trim()},execution_run_id:executionRunId,created_by:user.id});
              if(error)throw error;
            },
          });
          try{
            emit({type:"conversation",conversationId:conversation.id,title:conversation.title});
            emit({type:"status",message:"Understanding your request…"});
            let writingStatusSent=false;
            const releaseReadableText=async(force=false)=>{
              let next=takeReadableStreamChunk(displayBuffer,force);
              while(next){
                const {chunk,rest,pauseMs}=next;
                displayBuffer=rest;
                emit({type:"delta",delta:chunk});
                if(pauseMs&&!upstreamAbort.signal.aborted)await new Promise(resolve=>setTimeout(resolve,pauseMs));
                next=takeReadableStreamChunk(displayBuffer,force);
              }
            };
            const routed=await executeRoutedStreamingResponse(client,routePlan!,{
              instructions,input:body.message!.trim(),previousResponseId,
              tools:[{type:"mcp",server_label:"storm_signal",server_url:MCP_URL,require_approval:"never"}],
              promptCacheKey:`storm-signal:${membership.workspace_id}:chat-v1`,signal:upstreamAbort.signal,
              onMcpActivity:({name,status})=>emit({type:"status",message:customerActivityForTool(name,status)}),
              onTextDelta:(delta)=>{
                if(!writingStatusSent){writingStatusSent=true;emit({type:"status",message:"Writing the answer…"});}
                responseText+=delta;
                displayBuffer+=delta;
                return releaseReadableText(false);
              },
              onAttemptStart:usageLifecycle.onAttemptStart,onAttemptFinish:usageLifecycle.onAttemptFinish,
            });
            runId=usageLifecycle.getRunId();
            if(!runId)throw new Error("The execution reservation did not return a run identifier.");
            const completedResponse=routed.response;
            responseId=completedResponse.id;
            responseText=completedResponse.output_text||responseText||"The request completed without a text response.";
            if(!displayBuffer&&!writingStatusSent)displayBuffer=responseText;
            await releaseReadableText(true);
            tools=completedResponse.output.filter(item=>item.type==="mcp_call").map(item=>"name" in item?item.name:"Storm Signal tool");
            const inputTokens=routed.attempts.reduce((sum,attempt)=>sum+attempt.inputTokens,0);
            const outputTokens=routed.attempts.reduce((sum,attempt)=>sum+attempt.outputTokens,0);
            const measuredCost=routed.attempts.reduce((sum,attempt)=>sum+attempt.estimatedCostCents,0);
            const latencyMs=routed.attempts.reduce((sum,attempt)=>sum+attempt.latencyMs,0);
            await recordModelAttempts(admin,{workspaceId:membership.workspace_id,userId:user.id,conversationId:conversation.id,executionRunId:runId,operation:"weather_conversation",route:routed.route,attempts:routed.attempts});
            await admin.rpc("finalize_execution_for_user",{p_user_id:user.id,p_run_id:runId,p_status:"succeeded",p_input_tokens:inputTokens,p_output_tokens:outputTokens,p_mcp_calls:tools.length,p_estimated_cost_cents:measuredCost,p_error_code:null});
            await admin.from("execution_runs").update({model:completedResponse.model||routed.model.id,routing_capability:routed.route.capability,routing_reason:routed.route.reason,retry_count:Math.max(0,routed.attempts.length-1),latency_ms:latencyMs,cached_input_tokens:routed.attempts.reduce((sum,attempt)=>sum+attempt.cachedInputTokens,0),cache_write_tokens:routed.attempts.reduce((sum,attempt)=>sum+attempt.cacheWriteTokens,0)}).eq("id",runId);
            const {data:savedAssistant}=await admin.from("messages").insert({workspace_id:membership.workspace_id,conversation_id:conversation.id,role:"assistant",content:{text:responseText,tools,status:"complete"},execution_run_id:runId,created_by:null}).select("id").single();
            await admin.from("conversations").update({context:{...conversation.context,openai_response_id:responseId},updated_at:new Date().toISOString()}).eq("id",conversation.id).eq("workspace_id",membership.workspace_id);
            if(tools.length)emit({type:"evidence",tools});
            emit({type:"done",id:responseId,messageId:savedAssistant?.id,tools});
          }catch(error){
            const aborted=upstreamAbort.signal.aborted||(error instanceof Error&&error.name==="AbortError");
            const failedAttempts=attemptsFromError(error);
            if(routePlan&&failedAttempts.length)await recordModelAttempts(admin,{workspaceId:membership.workspace_id,userId:user.id,conversationId:conversation.id,executionRunId:runId,operation:"weather_conversation",route:routePlan,attempts:failedAttempts});
            runId=runId||usageLifecycle.getRunId();
            const failedCost=failedAttempts.reduce((sum,attempt)=>sum+attempt.estimatedCostCents,0);
            if(runId&&failedAttempts.every(attempt=>attempt.estimatedCostMicrousd===0))await usageLifecycle.voidEmptyTerminalWindow();
            if(runId)await admin.rpc("finalize_execution_for_user",{p_user_id:user.id,p_run_id:runId,p_status:aborted?"canceled":"failed",p_input_tokens:failedAttempts.reduce((sum,attempt)=>sum+attempt.inputTokens,0),p_output_tokens:failedAttempts.reduce((sum,attempt)=>sum+attempt.outputTokens,0),p_mcp_calls:tools.length,p_estimated_cost_cents:failedCost,p_error_code:aborted?"user_canceled":"provider_error"});
            if(responseText)await admin.from("messages").insert({workspace_id:membership.workspace_id,conversation_id:conversation.id,role:"assistant",content:{text:responseText,tools,status:"incomplete"},execution_run_id:runId,created_by:null});
            const usageError=error instanceof UsageControlError?usageControlMessage(error):null;
            emit({type:aborted?"stopped":"error",error:aborted?"Response stopped.":usageError||"Storm Signal could not complete this request.",retryAfter:error instanceof UsageControlError?error.retryAfter:undefined});
          }finally{
            if(open){open=false;try{controller.close();}catch{/* The browser may have disconnected. */}}
          }
        })();
      },
      cancel(){upstreamAbort.abort();},
    });
    return new Response(stream,{headers:{"content-type":"application/x-ndjson; charset=utf-8","cache-control":"no-cache, no-transform","x-accel-buffering":"no"}});
  }catch(error){
    if(runId)await createAdminClient().rpc("finalize_execution_for_user",{p_user_id:user.id,p_run_id:runId,p_status:"failed",p_input_tokens:0,p_output_tokens:0,p_mcp_calls:0,p_estimated_cost_cents:0,p_error_code:"provider_error"});
    const status=typeof error==="object"&&error&&"status" in error?Number(error.status):500;console.error("Storm Signal request failed:",status);return NextResponse.json({error:status===401?"OpenAI rejected the configured API key.":"Storm Signal could not complete this request."},{status:status===401?401:500});}
}
