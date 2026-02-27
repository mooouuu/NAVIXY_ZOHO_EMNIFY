# Arranque rápido (Navixy + Emnify)

1. Entrar al proyecto
   ```bash
   cd /Users/chakal/Documents/CODEX/NAVIXY_ZOHO/navixy-webapp
   ```

2. Verificar credenciales en `.env.local`
   - `NAVIXY_HASH` y `NAVIXY_DOMAIN` (ej. saas.navego.mx)
   - `EMNIFY_APP_TOKEN` (application_token de Emnify)
   - Opcional: `EMNIFY_BASE_URL=https://cdn.emnify.net/api/v1`

3. Limpiar caché de Next (solo si hay fallas al arrancar)
   ```bash
   rm -rf .next node_modules/.cache/turbo 2>/dev/null
   ```

4. Levantar el servidor (Webpack, sin Turbopack)
   ```bash
   NEXT_DISABLE_TURBOPACK=1 npm run dev
   ```
   - Espera a ver `Local: http://localhost:3000`.

5. Probar la API de SIM (opcional, en otra terminal)
   ```bash
   curl -X POST http://localhost:3000/api/sim-status \
     -H "Content-Type: application/json" \
     -d '{"imeis":["860896050035500"]}'
   ```
   Debe devolver status ONLINE, RAT 4G, operador Telcel.

6. Abrir el dashboard
   - Navega a http://localhost:3000 y pulsa “Actualizar”.
   - Verás trackers Navixy y, en cada tarjeta, datos de SIM (estado, RAT, operador).

Notas
- Si vuelve a aparecer un error de Turbopack, repite paso 3 y arranca con `NEXT_DISABLE_TURBOPACK=1`.
- El refresco de trackers es cada 60 s; alertas SOS cada 10 s.
- El estado de SIM se consulta cada 60 s.
