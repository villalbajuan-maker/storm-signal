-- SAME location codes use PSSCCC: one partition digit, two state-FIPS digits,
-- then three county digits. Earlier ingestion incorrectly kept the first two
-- characters (partition + first FIPS digit) as the event state.
with state_codes(state_fips,state_code) as (values
  ('01','AL'),('02','AK'),('04','AZ'),('05','AR'),('06','CA'),('08','CO'),('09','CT'),('10','DE'),('11','DC'),
  ('12','FL'),('13','GA'),('15','HI'),('16','ID'),('17','IL'),('18','IN'),('19','IA'),('20','KS'),('21','KY'),
  ('22','LA'),('23','ME'),('24','MD'),('25','MA'),('26','MI'),('27','MN'),('28','MS'),('29','MO'),('30','MT'),
  ('31','NE'),('32','NV'),('33','NH'),('34','NJ'),('35','NM'),('36','NY'),('37','NC'),('38','ND'),('39','OH'),
  ('40','OK'),('41','OR'),('42','PA'),('44','RI'),('45','SC'),('46','SD'),('47','TN'),('48','TX'),('49','UT'),
  ('50','VT'),('51','VA'),('53','WA'),('54','WV'),('55','WI'),('56','WY'),('60','AS'),('66','GU'),('69','MP'),
  ('72','PR'),('78','VI')
), normalized as (
  select e.id,sc.state_code
  from public.storm_events e
  join public.source_records r on r.id=e.raw_record_id
  join state_codes sc on sc.state_fips=substring(r.payload_json #>> '{properties,geocode,SAME,0}' from 2 for 2)
  where e.source='nws_alerts' and e.started_at>=now()-interval '14 days'
), updated as (
  update public.storm_events e set state=n.state_code,updated_at=now()
  from normalized n where e.id=n.id and e.state is distinct from n.state_code
  returning e.id
)
select count(*) as nws_states_corrected from updated;
