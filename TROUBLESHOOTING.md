# Se rompió, ¿ahora qué?

Esta guía es para ti (quien vende y opera el servicio), no para el cliente. El objetivo es
que sepas diagnosticar rápido y que, si algo falla, el negocio nunca se quede "a ciegas"
sin poder contestar a sus clientes — y que tú no quedes mal.

## Regla de oro: el bot NUNCA debe ser el único canal

Desde el día 1, dile al dueño: *"si el bot tarda o falla, tus clientes te van a poder seguir
escribiendo al mismo WhatsApp de siempre, tú decides si contestas o esperas al bot"*. El
bot vive en el mismo número que ya usaban — no es un canal nuevo y aislado. Eso significa
que un fallo del bot en el peor caso es "tardó en contestar", nunca "el negocio se quedó
sin poder recibir pedidos".

## Los 5 problemas más comunes (y cómo se arreglan)

### 1. El bot dejó de contestar por completo
**Causa típica:** Railway se quedó sin saldo/horas gratis, o el servidor se cayó.
**Cómo lo diagnosticas:** entra a `https://tu-bot.up.railway.app/` en el navegador. Si no
carga o no dice "Bot de WhatsApp funcionando ✅", el servidor está caído.
**Arreglo:** entra al panel de Railway → pestaña "Deployments" → botón "Redeploy". Tarda
1-2 minutos en volver a estar activo.
**Qué le dices al cliente:** *"Tuvimos un tema técnico con el proveedor de hosting, ya está
resuelto, dame 5 minutos para confirmar que quedó al 100%."* — es verdad, es normal, y no
suena a que tú lo rompiste.

### 2. El token de WhatsApp expiró (token temporal de 24h)
**Causa típica:** no se generó el token permanente (Paso 2 del manual de instalación).
**Cómo lo diagnosticas:** en los logs de Railway (pestaña "Logs") vas a ver errores como
`Error al enviar mensaje de WhatsApp: ... "Error validating access token"`.
**Arreglo:** genera el token permanente en el panel de Meta (requiere Business
Verification ya aprobada) y actualiza la variable `WHATSAPP_TOKEN` en Railway.
**Prevención:** haz esto ANTES de entregar el proyecto, no dejes el bot en producción con
token temporal.

### 3. La IA contesta cosas raras o inventa información
**Causa típica:** el Google Sheet del negocio quedó incompleto, ambiguo, o con formato
confuso.
**Cómo lo diagnosticas:** pídele al dueño capturas de pantalla de la conversación rara.
**Arreglo:** revisa y ordena el Google Sheet, sé más explícito (ej: en vez de "abrimos
tarde", escribe "Lunes a sábado 8am-8pm"). El bot mejora solo, sin tocar código.

### 4. El bot no le avisa al dueño de los pedidos nuevos
**Causa típica:** la variable `OWNER_WHATSAPP_NUMBER` está mal escrita (falta el código de
país, o tiene espacios/guiones).
**Arreglo:** debe ser solo números, con código de país, sin `+` ni espacios. Ejemplo
correcto para México: `5215512345678`.

### 5. El menú no se actualizó después de que el dueño lo editó
**Causa típica:** el bot guarda una copia (cache) por 10 minutos para no ir a Google cada
vez — es normal que tarde hasta 10 minutos en reflejar un cambio.
**Arreglo:** si pasaron más de 10 minutos y sigue sin actualizar, revisa que el Google
Sheet siga "Publicado en la Web" (a veces Google lo desactiva si se edita mucho la
estructura de la hoja) — Archivo → Compartir → Publicar en la Web, verifica que diga
"Publicado".

### 6. Los links de "en revisión"/"resuelto" no funcionan, o el dashboard dice "No autorizado"
**Causa típica:** falta configurar `URL_PUBLICA_DEL_SERVIDOR` o `TOKEN_DASHBOARD` en
Railway (Paso 4b del manual), o el `token` en la URL que estás usando no coincide con
`TOKEN_DASHBOARD`.
**Arreglo:** revisa esas dos variables en Railway. Si cambiaste `TOKEN_DASHBOARD`
después de haber mandado algún aviso, los links viejos van a dejar de servir — es
normal, solo hay que esperar al siguiente ticket nuevo (o entrar al dashboard con el
token nuevo).

## El ciclo de "casos difíciles" — revísalo seguido

Cada vez que el bot no supo contestar algo (necesitó a un humano, fue una alerta
urgente, o hubo un error técnico), queda anotado en `casos-dificiles.json`, dentro de
la carpeta del bot. Ábrelo con el Bloc de notas de vez en cuando (una vez a la semana
para un negocio chico es suficiente) y por cada pregunta que se repita o valga la pena,
agrégala con su respuesta correcta a la pestaña "Aprendizaje" del Google Sheet (ver
Paso 1b del manual de instalación). Así el bot cubre cada vez más casos sin que nadie
toque código — pero el trabajo de revisar y decidir la respuesta correcta siempre lo
hace una persona, nunca la IA sola.

## Otras protecciones que ya trae el bot (para que sepas que existen)

- **No contesta dos veces el mismo mensaje:** si Meta reenvía un mensaje (pasa si el bot
  tardó en responder), el bot lo detecta por su ID y lo ignora la segunda vez.
- **Se frena solo ante flood/spam:** si un mismo número manda más de 20 mensajes en un
  minuto, el bot deja de contestarle temporalmente (para no gastar de más en IA ni
  saturar al negocio). Esto es automático, no hace falta tocar nada.
- **Fotos, audios, videos, notas de voz, ubicación, stickers:** el bot avisa que por
  ahora solo lee texto, en vez de quedarse callado o tronar.
- **Amenazas o contenido grave:** se detectan ANTES de que la IA intervenga (ver
  `seguridad.js`) y se le avisa al dueño de forma marcada como urgente.
- **Intentos de manipular al bot** ("ignora tus instrucciones", "dame un descuento que
  tú no puedes dar", "finjo ser el dueño"): el bot está instruido para no ceder y
  escalar a un humano si la persona insiste.

## Cómo monitorear sin que el cliente tenga que avisarte

- Revisa una vez al día la pestaña **Logs** de Railway, filtrando la palabra `Error`.
- Considera (para cuando tengas 5+ clientes) un servicio gratis de monitoreo como
  [UptimeRobot](https://uptimerobot.com) que le pega cada 5 minutos a la URL del bot y te
  avisa por correo si se cae — así te enteras tú antes que el cliente.

## Cómo comunicar un fallo sin quedar mal

1. **Avísale tú primero, antes de que él note el problema**, si es posible. Cambia
   completamente la percepción ("está pendiente de mi negocio" vs. "se le cayó el sistema").
2. Sé breve y concreto: qué pasó, qué tan grave fue, y que ya quedó resuelto (o para cuándo).
3. Nunca digas "no sé qué pasó" — aunque no sepas la causa exacta todavía, di "ya lo estoy
   revisando, te confirmo en la próxima hora" y cumple ese plazo.
4. Si el fallo le costó pedidos perdidos, ofrece un gesto (un mes de mensualidad gratis o un
   descuento) solo si fue un fallo grave y prolongado — no lo hagas por cada cosa mínima.
