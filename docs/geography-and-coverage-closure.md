# Storm Signal — Cierre geográfico y estado de cobertura

**Fecha de corte:** 19 de julio de 2026  
**Estado:** geografía comercial inicial completada; plan siguiente congelado en el orden de este documento

## Resumen ejecutivo

Storm Signal ya tiene una base geográfica operativa y auditable para 12 estados comerciales. Los eventos pueden persistirse con evidencia original, representarse en PostGIS y relacionarse con estado, condado, lugar Census y ZCTA. La plataforma también tiene ingesta automática y fresca para alertas NWS y reportes preliminares SPC de granizo, viento y tornado.

La cobertura no está completa para todos los peligros. Huracanes, campos de viento tropical, marejada ciclónica, inundaciones fluviales y crecidas rápidas siguen sin conectores ni modelos persistidos. Tampoco está terminado el recorrido comercial: falta automatizar el enriquecimiento geográfico de cada evento nuevo, buscar desde el MCP por geografía derivada, priorizar mercados, construir planes de campo y generar entregables persistentes.

## 1. Geografía disponible

La versión territorial vigente utiliza TIGER/Line y TIGERweb de Census 2025, PostGIS con SRID 4326 y un método de enriquecimiento versionado como `census-postgis-v1`.

| Estado | Condados | Lugares Census | ZCTAs que intersectan el estado | Estado operativo |
|---|---:|---:|---:|---|
| Colorado | 64 | 482 | 567 | Auditado; sin eventos actuales |
| Florida | 67 | 958 | 1.024 | Auditado y aplicado |
| Georgia | 159 | 676 | 842 | Auditado; sin eventos actuales |
| Kansas | 105 | 740 | 771 | Auditado; sin eventos actuales |
| Louisiana | 64 | 484 | 577 | Auditado; sin eventos actuales |
| Missouri | 115 | 1.081 | 1.154 | Auditado y aplicado |
| Montana | 56 | 497 | 393 | Auditado y aplicado |
| Nebraska | 93 | 593 | 669 | Auditado; sin eventos actuales |
| North Carolina | 100 | 776 | 919 | Auditado y aplicado |
| Oklahoma | 77 | 846 | 744 | Auditado y aplicado |
| South Carolina | 46 | 475 | 462 | Auditado; sin eventos actuales |
| Texas | 254 | 1.863 | 2.073 | Auditado y aplicado |

Inventario físico compartido en Supabase:

- 12 polígonos estatales;
- 1.200 condados;
- 9.471 lugares Census;
- 11.568 ZCTAs almacenados y reutilizados entre estados;
- cero geometrías inválidas en las cuatro capas.

Los ZCTAs son áreas estadísticas aproximadas de códigos postales y no límites de entrega USPS. Las asociaciones geográficas son evidencia derivada y conservan su versión de método.

## 2. Estado de los eventos y del enriquecimiento

Al momento del corte existen 1.481 eventos persistidos, con cobertura temporal entre el 12 de febrero de 2025 y el 19 de julio de 2026.

- 1.065 eventos tienen enriquecimiento geográfico `complete`.
- 402 tienen enriquecimiento `partial`, principalmente porque su estado no pertenece todavía a los 12 territorios cargados o la evidencia geográfica es insuficiente.
- 14 eventos recientes no tienen todavía registro de procesamiento geográfico.

La última cifra demuestra una brecha operativa concreta: el enriquecimiento se ha ejecutado durante las expansiones estatales, pero todavía no se dispara automáticamente después de cada ingesta nueva.

## 3. Amenazas y fuentes realmente implementadas

### Operativas

| Evidencia | Fuente oficial | Clase | Automatización | Datos persistidos al corte |
|---|---|---|---|---:|
| Alertas de tormenta severa | NWS active alerts | `warning` | Cada 5 minutos | 7 activas/versionadas como eventos actuales |
| Alertas de tornado | NWS active alerts | `warning` | Cada 5 minutos | Soportadas; 0 presentes al corte |
| Reportes de granizo | SPC daily storm reports | `observed`, preliminar | Cada 10 minutos, hoy y ayer | 10 |
| Reportes de viento | SPC daily storm reports | `observed`, preliminar | Cada 10 minutos, hoy y ayer | 461 |
| Reportes de tornado | SPC daily storm reports | `observed`, preliminar | Cada 10 minutos, hoy y ayer | 3 |
| Granizo histórico | NOAA/NCEI Storm Events | `historical` | Importación histórica acotada/manual | 1.000 |

Esto significa que la primera familia de tormentas severas sí existe: advertencias de tormenta severa y tornado, más observaciones preliminares de granizo, viento y tornado. No significa que tengamos pronóstico convectivo completo, huellas de impacto ni confirmación de daño en una propiedad.

### No implementadas todavía

| Amenaza o evidencia | Estado actual | Conector oficial recomendado |
|---|---|---|
| Ciclones y huracanes activos | Roadmap | NHC advisories y GIS feeds |
| Trayectoria, cono, watches y warnings tropicales | Roadmap | NHC GIS/RSS |
| Campos de viento de 34/50/64 kt y probabilidades | Roadmap | NHC wind radii/probability products |
| Marejada ciclónica | Roadmap | NHC storm-surge watches, warnings y probabilidades |
| Observaciones y pronósticos fluviales | Roadmap | NOAA National Water Prediction Service |
| Crecida rápida o rapid-onset flooding | Roadmap | National Water Model/NWPS |
| Historial oficial de ciclones | Roadmap | NHC HURDAT2 |
| Riesgo base de inundación | Roadmap | FEMA National Flood Hazard Layer |

FEMA debe tratarse como contexto de riesgo base, no como prueba de que ocurrió una inundación. Un cono o probabilidad de viento tampoco es una huella de impacto observado.

## 4. Arquitectura y conectores actuales

```text
NWS active alerts ─┐
                   ├─> Supabase Edge Function storm_signal_ingestor
SPC daily reports ─┘          │
                              ├─> source_records (evidencia cruda versionada)
                              ├─> storm_events (interpretación normalizada)
                              └─> ingestion_runs (salud y trazabilidad)

NCEI histórico ─────> importador Python ────────────────┘
Census TIGER ───────> importador Python/GDAL ─> PostGIS geographic_areas
                                                        │
Cloud/Claude ─> mcp.vectoros.co (Cloudflare) ─> Supabase Edge MCP ─> RPC Postgres
```

Responsabilidades:

- **Supabase Edge Function:** ingesta viva de NWS y SPC por HTTPS directo; no requiere túnel.
- **pg_cron + pg_net:** agenda NWS cada 5 minutos y SPC cada 10 minutos. Ambos trabajos están activos.
- **Python:** importación histórica NCEI, reconocimiento y cargas geográficas masivas de Census; no es el proceso continuo principal.
- **GDAL/ogr2ogr:** transformación de geometrías Census a GeoJSON/SRID 4326 durante las cargas masivas.
- **Supabase/Postgres/PostGIS:** persistencia, deduplicación, versiones crudas, geometría, asociaciones, salud y RPC deterministas.
- **Cloudflare:** dominio comercial y gateway liviano en `mcp.vectoros.co`; no procesa ni almacena evidencia meteorológica.
- **MCP en Supabase:** servidor remoto de solo lectura consumido desde Cloud/Claude.

No hace falta contratar un conector genérico externo para las fuentes oficiales actuales: son APIs y feeds públicos consumidos directamente. Sí hace falta construir adaptadores nuevos, con contratos de normalización propios, para NHC, NWPS/National Water Model y FEMA.

## 5. Capacidades actuales del MCP

El MCP expone cuatro tools de solo lectura:

1. `search_storm_events`: búsqueda por tiempo, tipo, estado/condado almacenado, magnitud de granizo, estado del evento y radio desde coordenadas.
2. `get_storm_event`: detalle normalizado, versiones de evidencia cruda y geografía Census derivada.
3. `assess_location`: evaluación determinista de evidencia para una coordenada, radio y ventana temporal.
4. `summarize_storm_activity`: agregación por tipo, estado, condado o día.

Limitaciones actuales:

- `get_storm_event` ya presenta estado, condado, lugar y ZCTA derivados.
- `search_storm_events` todavía no filtra por lugar Census o ZCTA derivados; usa los campos directos `state` y `county` del evento.
- `assess_location` fue diseñado inicialmente alrededor de granizo y warnings; todavía no puntúa viento o tornado con un contrato comercial completo.
- no existen tools deterministas para priorizar mercados, construir planes de campo o generar reportes persistentes.
- `data_health` informa frescura meteorológica general, pero todavía no expone claramente cobertura y pendientes de geografía por estado.

## 6. Qué sigue: orden recomendado

### Prioridad 1 — cerrar la unión automática entre clima y geografía

1. Ejecutar un backfill único e idempotente de todos los eventos que no tengan estado geográfico para la versión vigente; al corte existen 14 pendientes.
2. Ejecutar enriquecimiento PostGIS automáticamente después de cada upsert de eventos nuevos o actualizados.
3. Registrar métricas y errores del enriquecimiento por corrida y mantener en cero el contador de eventos sin procesar.
4. Extender `data_health` con estados cubiertos, eventos `complete`/`partial`/sin procesar y versión geográfica.
5. Extender el MCP para buscar por condado derivado, lugar Census y ZCTA.

Este paso debe completarse antes de ampliar peligros: garantiza que toda fuente nueva llegue a la misma base territorial y sea consultable comercialmente.

El backfill no inventa cobertura ni fuerza asociaciones. Un evento fuera de los 12 estados cargados, o sin geometría suficiente, debe quedar procesado con estado `partial` o `insufficient_geometry`; el objetivo de cero aplica a eventos sin procesar, no a eliminar resultados parciales honestos.

### Prioridad 2 — completar tormentas severas

1. Mantener SPC hail/wind/tornado y NWS warnings ya operativos.
2. Agregar pronósticos convectivos SPC, manteniéndolos como `forecast` y separados de reportes observados.
3. Definir métricas deterministas para viento y tornado dentro de evaluación y priorización.
4. Ampliar NCEI histórico más allá de granizo para viento, tornado e inundación cuando la normalización esté acordada.

### Prioridad 3 — huracanes y costa del Golfo

1. NHC advisories, trayectoria, cono, watches y warnings.
2. Campos y probabilidades de viento tropical.
3. Marejada ciclónica.
4. HURDAT2 como historia oficial separada de la operación activa.

### Prioridad 4 — inundaciones y crecidas rápidas

1. NWPS para observaciones, pronóstico de niveles/caudal y categorías de inundación.
2. National Water Model para rapid-onset/high-flow forecasts.
3. FEMA NFHL como capa persistente de riesgo base.
4. Contrato explícito para distinguir `observed`, `warning`, `forecast` y `baseline_risk`.

### Prioridad 5 — cumplir el eje comercial

1. **Rank the markets:** clasificación versionada `prioritize`, `monitor` o `insufficient_evidence`.
2. **Build the field plan:** territorios seleccionados, equipos, secuencia, tiempos y validaciones de campo.
3. **Share the brief:** Field Brief PDF, Deployment Plan PDF y Priority Areas Excel/CSV con snapshot de evidencia.

## Decisión recomendada

El siguiente sprint debe cerrar primero la automatización geográfica y la consulta MCP por lugar/ZCTA. Inmediatamente después conviene implementar NHC como la siguiente familia de conectores, seguida por NWPS/National Water Model. Así, cada peligro nuevo entra sobre una arquitectura territorial ya automática y puede alimentar directamente la promesa comercial, sin crear otra isla de datos.

## Registro de ejecución del sprint

### Tramo 1 — Backfill geográfico: completado

El 19 de julio de 2026 se desplegó `backfill_unprocessed_storm_event_geographies`, una operación idempotente que selecciona exclusivamente eventos sin estado de procesamiento para la versión geográfica vigente.

- Primera ejecución: 16 eventos procesados; 2 `complete` y 14 `partial`.
- Segunda ejecución de control: capturó 2 eventos creados por la ingesta concurrente; 1 `complete` y 1 `partial`.
- Corte final: 1.485 eventos, 1.068 `complete`, 417 `partial`, 0 `insufficient_geometry` y 0 sin procesar.
- Un resultado `complete` exige asociaciones de estado, condado y ZCTA; el lugar Census es opcional.
- La operación con arreglo vacío permanece acotada y nunca se interpreta como reprocesamiento de todos los eventos.

La aparición de eventos entre dos ejecuciones confirma la necesidad del Tramo 2: encadenar el enriquecimiento automáticamente a la ingesta.
