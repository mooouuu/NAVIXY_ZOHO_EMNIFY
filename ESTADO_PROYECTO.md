# Estado del proyecto Navixy + Emnify + Zoho

## Objetivo del proyecto

Construir una herramienta interna para soporte técnico que permita:

- ver el estado de trackers Navixy en tiempo real
- consultar el estado de la SIM en Emnify
- identificar empresa y contactos desde Zoho
- ejecutar acciones remotas sobre equipos Teltonika
- reducir tiempos de atención y dejar base lista para automatización futura

## Stack actual

- Frontend y backend web: `Next.js`
- Integraciones:
  - `Navixy`
  - `Emnify`
  - `Zoho CRM`
- Automatización operativa:
  - `Python` para rutinas programadas sobre Emnify/Teltonika

## Qué ya quedó resuelto

### Dashboard web

El dashboard en la raíz del proyecto muestra tarjetas por unidad con bloques separados:

- `Navixy`
  - nombre de unidad
  - ID
  - IMEI copiable
  - última señal
  - latitud y longitud
  - botón de Google Maps
  - velocidad
  - motor
  - batería
  - dirección
- `Emnify`
  - estado de SIM
  - RAT
  - operador
  - ICCID o MSISDN
  - botón para reset de conectividad
  - envío de SMS
  - lectura de últimos SMS
- `Zoho`
  - empresa
  - todos los contactos asociados al cliente
  - teléfono de cada contacto

### Integración Navixy

Ya funciona:

- lectura de trackers
- lectura de alertas SOS
- render del estado de las unidades

### Integración Emnify

Ya funciona:

- búsqueda del endpoint por IMEI
- lectura de conectividad
- lectura de SMS
- envío de SMS desde la API
- reset de conectividad

Detalles importantes descubiertos:

- en Emnify el `device name` coincide con el IMEI
- para enviar SMS vía API fue necesario usar:
  - `source_address=Emnify`
  - `source_address_type={ id: 208 }` cuando el sender es alfanumérico
- para reset de conectividad la API correcta fue:
  - `PATCH /endpoint/{endpoint_id}/connectivity`
  - body: `{"location": null, "pdp_context": null}`
- los SMS recibidos no venían como `direction=mo/mt`, sino como:
  - `sms_type.description = MO`
  - `sms_type.description = MT`

### Integración Zoho

Ya funciona:

- lectura de empresas
- lectura de contactos
- lectura de módulo de dispositivos
- asociación por IMEI
- despliegue del cliente y sus contactos en cada tarjeta

## Módulos de Zoho usados

- `Accounts`
  - empresa
- `Contacts`
  - nombre
  - apellido
  - móvil
  - teléfono
  - empresa asociada
- `GPS`
  - corresponde al módulo de `ControlGPS`
  - IMEI del dispositivo
  - cliente
  - inventario SIM
- `ControlSIM`
  - inventario SIM
  - tipo de SIM

## Comandos SMS Teltonika definidos

En la UI quedaron como opciones:

- `setdigout 000`
- `setdigout 111`
- `web_connect`
- `getgps`

En la rutina Python para el caso de paro/encendido quedaron:

- apagado: `setdigout ?1?`
- encendido: `setdigout ?0?`

Todos los mensajes salen con dos espacios al inicio:

```text
  getgps
  setdigout ?1?
  setdigout ?0?
```

## Rutina Python creada

Archivo:

- [scripts/emnify_weekend_routine.py](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/scripts/emnify_weekend_routine.py)

La rutina hace esto:

### Acción `on`

1. busca el endpoint por IMEI
2. hace reset de conectividad
3. espera 180 segundos
4. valida red estable con dos lecturas consecutivas:
   - `ONLINE`
   - `4G` o `LTE`
5. manda `getgps` como prueba real del canal SMS
6. espera respuesta `MO`
7. si responde, manda el comando final `setdigout ?0?`
8. guarda resultado en log

### Acción `off`

1. busca el endpoint por IMEI
2. valida red estable
3. manda `getgps`
4. espera respuesta
5. si responde, manda `setdigout ?1?`
6. guarda resultado en log

### Logs

Se guardan en:

- `logs/emnify-routines/*.log`
- `logs/emnify-routines/*.json`
- `logs/emnify-routines/history.jsonl`

## Validaciones reales ya comprobadas

### IMEI probado

- `865413054332696`

### Resultado exitoso comprobado

Se logró completar exitosamente el flujo:

1. reset de conectividad
2. espera de 3 minutos
3. validación `ONLINE + 4G`
4. envío de `getgps`
5. recepción de respuesta del dispositivo
6. envío de `setdigout ?0?`
7. recepción de respuesta del dispositivo

Respuesta confirmada:

```text
DOUT1:IGNORED DOUT2:Already set to 0 DOUT3:IGNORED
```

Esto confirma que:

- el SMS sí llega al equipo
- el equipo sí responde
- la rutina sí puede validar respuesta antes del comando final
- `DO2` es el canal correcto para la lógica actual

## Prueba agendada en servidor

Servidor:

- `mauricio@82.25.86.179`

Ruta del proyecto en servidor:

- `~/NAVIXY_ZOHO_EMNIFY`

Archivo de entorno en servidor:

- `.env.production`

Prueba programada con `at`:

- apagado: `05:00 AM UTC` del 7 de abril de 2026
  - equivalente a `11:00 PM` hora CDMX del 6 de abril de 2026
- encendido: `05:40 AM UTC` del 7 de abril de 2026
  - equivalente a `11:40 PM` hora CDMX del 6 de abril de 2026

Log consolidado de la prueba:

- `/home/mauricio/NAVIXY_ZOHO_EMNIFY/logs/emnify-routines/test-tonight.log`

## Estado del servidor

Se detectó que el servidor está en:

- `UTC`

No está todavía en:

- `America/Mexico_City`

Por eso las pruebas temporales se programaron en UTC para evitar errores hoy.

## Variables de entorno necesarias

En local y producción se usan:

- `NAVIXY_DOMAIN`
- `NAVIXY_HASH`
- `EMNIFY_APP_TOKEN`
- `EMNIFY_BASE_URL`
- `EMNIFY_SMS_SOURCE_ADDRESS`
- `EMNIFY_SMS_SOURCE_ADDRESSES`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`

## Decisiones técnicas importantes

- Zoho no se consulta en tiempo real para soporte futuro; la idea es sincronizarlo periódicamente
- Emnify sí se consulta bajo demanda o por rutinas operativas
- la validación correcta antes del comando no es solo `4G`; también debe existir respuesta real por SMS
- el `getgps` quedó como prueba de salud del canal SMS

## Ideas de mejora siguientes

### Operación

- agregar lock para evitar doble ejecución simultánea de la rutina
- ejecutar por lotes o en paralelo controlado si se aplicará a muchos IMEIs
- agregar reintentos automáticos si `getgps` no responde al primer intento
- mandar resumen automático por correo o WhatsApp al terminar una rutina

### Plataforma

- pasar inventario de Zoho a `Supabase`
- usar actualización diaria para empresas, contactos y relaciones
- dejar a Navixy por eventos/webhooks
- dejar a Emnify como fuente operativa para conectividad y SMS

### Futuro

- agregar paro/encendido desde Navixy si se decide manejar salidas digitales por esa vía
- integrar `ElevenLabs` para llamadas automatizadas a clientes
- exponer un flujo para agente de soporte o agente `n8n/WhatsApp`

## Archivos clave del proyecto

- [src/app/page.tsx](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/app/page.tsx)
- [src/lib/emnify.ts](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/lib/emnify.ts)
- [src/lib/zoho.ts](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/lib/zoho.ts)
- [src/app/api/sim-status/route.ts](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/app/api/sim-status/route.ts)
- [src/app/api/sim-reset/route.ts](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/app/api/sim-reset/route.ts)
- [src/app/api/sim-sms/route.ts](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/src/app/api/sim-sms/route.ts)
- [scripts/emnify_weekend_routine.py](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/scripts/emnify_weekend_routine.py)
- [arranque.md](/Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp/arranque.md)

## Punto de continuación para mañana

1. revisar `test-tonight.log`
2. confirmar resultado de `off`
3. confirmar resultado de `on`
4. convertir prueba temporal en `cron` semanal
5. decidir si se cambia timezone del servidor a `America/Mexico_City`
