# Enfoque geográfico de cinco estados — cierre de tramos 1 y 2

Fecha: 19 de julio de 2026  
Estado: alcance congelado y modo seco terminado; no se eliminó geografía.

## Alcance congelado

Se conservan:

| Estado | FIPS |
|---|---:|
| Texas | 48 |
| Florida | 12 |
| Louisiana | 22 |
| Georgia | 13 |
| North Carolina | 37 |

Se preparan para respaldo y posterior eliminación:

| Estado | FIPS |
|---|---:|
| Colorado | 08 |
| Kansas | 20 |
| Missouri | 29 |
| Montana | 30 |
| Nebraska | 31 |
| Oklahoma | 40 |
| South Carolina | 45 |

La retención automática `storm-signal-retention-daily` quedó desactivada. No debe reactivarse antes de acordar una política independiente para datos operativos.

## Regla de clasificación

- Estados, condados y lugares: se conservan cuando `state_fips` pertenece a uno de los cinco estados focales.
- ZCTA: se conserva todo polígono que intersecte espacialmente al menos uno de los cinco estados focales.
- Solo se considera removible un ZCTA que no intersecte ninguno de los estados conservados. Esto protege los ZIP/ZCTA fronterizos compartidos.

## Resultado del modo seco

| Tipo | Conserva filas | Conserva geometría | Retira filas | Retira geometría |
|---|---:|---:|---:|---:|
| State | 5 | 2,624 kB | 7 | 1,884 kB |
| County | 644 | 29 MB | 556 | 18 MB |
| Place | 4,757 | 48 MB | 4,714 | 28 MB |
| ZCTA | 5,360 | 135 MB | 6,208 | 166 MB |
| **Total** | **10,766** | **~215 MB** | **11,485** | **~214 MB** |

La tabla `geographic_areas` ocupaba aproximadamente 499 MB antes de la reducción. Los ~214 MB anteriores son tamaño lógico de geometrías, no espacio físico garantizado. La recuperación física estimada después de eliminar, limpiar índices y compactar es de aproximadamente 230–250 MB; se medirá únicamente en el tramo 5.

## Impacto en asociaciones

| Relación | Asociaciones retirables | Registros afectados | Registros sin geografía después | Asociaciones conservadas |
|---|---:|---:|---:|---:|
| `storm_event_areas` | 99 | 24 eventos | 18 eventos | 492 |
| `cyclone_feature_areas` | 99 | 2 features | 0 features | 4,076 |

Los 18 eventos no se borrarían: únicamente quedarían sin asociación geográfica porque se encuentran por completo fuera del foco comercial. La decisión sobre conservarlos o aplicar retención operativa es separada de la reducción de Census/PostGIS.

## Puerta de control

Tramos 1, 2, 3 y 4 están completos. El tramo 3 generó una instantánea lógica completa de los datos públicos, que incluye las 22,251 geografías y sus asociaciones, en `backups/geography-2026-07-19-pre-reduction-full/public-data.sql.gz`. El archivo local comprimido ocupa 368 MB y pasó verificación de integridad gzip y SHA-256.

El tramo 4 eliminó en una transacción atómica las 11,485 geografías aprobadas. Quedaron 10,766 geografías, los cinco estados focales y ninguna geografía no-ZCTA de los siete estados retirados. Las cascadas retiraron 99 asociaciones de eventos y 99 asociaciones ciclónicas: quedaron 590 y 4,076 respectivamente, sin huérfanos. La tabla continúa ocupando 499 MB físicamente porque todavía no se ha compactado. Esa recuperación y su medición pertenecen exclusivamente al tramo 5.

## Cierre del tramo 5

El tramo 5 compactó y analizó `geographic_areas` con `VACUUM FULL ANALYZE`. La base completa bajó de 528 MB a 268 MB y `geographic_areas` bajó de 499 MB a 239 MB: se recuperaron 260 MB físicos. La tabla conservó exactamente 10,766 filas.

Las ingestas NWS, SPC y NHC fueron pausadas durante la reescritura y reactivadas al terminar; las tres quedaron activas y la retención diaria permanece desactivada. Las ejecuciones posteriores reportaron estado `complete`. La cobertura persistida del MCP fue alineada con los cinco estados focales y `mcp_data_health` devuelve `covered_state_count: 5` con cola geográfica saludable.

Pruebas de aceptación completadas:

- Austin, Miami, New Orleans, Atlanta y Charlotte resolvieron al estado focal correcto.
- Denver no resolvió a ninguna geografía estatal, como corresponde al alcance retirado.
- El endpoint público `https://mcp.vectoros.co/health` respondió `status: ok`.
- `search_storm_events` sobre Texas devolvió eventos recientes de viento con estado, condado y ZCTA derivados.
- No existen asociaciones geográficas huérfanas.

Los cinco tramos de reducción geográfica están completos.
