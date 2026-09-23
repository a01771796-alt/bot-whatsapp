# Manual de instalación — Bot de WhatsApp

Esta guía asume que **no sabes nada de programación**. Ve paso a paso, sin saltarte ninguno.
Vas a necesitar unos 45-60 minutos la primera vez. Después de esto, el dueño del negocio
solo va a usar una hoja de Google Sheets — nada de código.

Vas a crear 4 cuentas gratuitas (o casi gratuitas) y a conectarlas entre sí:

1. **Meta for Developers** → el número de WhatsApp que va a contestar solo.
2. **Google Sheets** → donde se escribe el menú, horario y preguntas frecuentes.
3. **Anthropic (Claude)** → la inteligencia artificial que redacta las respuestas.
4. **Railway** → la "computadora en internet" donde vive el bot, prendida 24/7.

---

## Paso 1 — Crear el Google Sheet del negocio

1. Entra a [sheets.google.com](https://sheets.google.com) y crea una hoja nueva.
2. En la columna A escribe, renglón por renglón, toda la información del negocio en texto
   normal. Por ejemplo:

   ```
   Nombre: Café La Esquina
   Horario: Lunes a sábado de 8am a 8pm, domingo cerrado
   Ubicación: Av. Reforma 123, colonia Centro, a media cuadra del metro Juárez
   Wifi: Sí, gratis, la clave la da el mesero
   Métodos de pago: Efectivo y tarjeta, no aceptamos transferencia
   Menú:
   - Café americano $35
   - Café con leche $40
   - Capuchino $45
   - Sandwich de jamón y queso $65
   - Croissant $30
   Promociones: 2x1 en café americano de 8am a 10am
   ```

   No importa el orden ni el formato exacto — la inteligencia artificial lo va a leer y
   entender igual. Mientras más completo, mejor contesta el bot.

3. Ve a **Archivo → Compartir → Publicar en la Web**.
4. En "Publicar en la Web" elige: la hoja correcta, y como formato elige **Valores separados
   por comas (.csv)**. Da clic en **Publicar**.
5. Copia el link que te da Google. Se ve algo así:
   `https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv`
6. Guarda ese link, lo vas a usar en el Paso 5.

> Para actualizar el menú en el futuro, el dueño solo edita esta misma hoja y guarda —
> el bot la vuelve a leer automáticamente cada 10 minutos, sin que nadie toque nada más.

---

## Paso 1b (opcional pero recomendado) — La pestaña de "Aprendizaje"

El bot no "aprende solo" de las conversaciones — eso ninguna IA por API lo hace de verdad.
Lo que sí tiene es un ciclo real para ir mejorando con el tiempo:

1. En el mismo Google Sheet del Paso 1, crea una **segunda pestaña** (clic en el "+" abajo)
   y llámala "Aprendizaje". En la columna A escribe preguntas que el bot no supo contestar,
   y junto la respuesta correcta, así:

   ```
   Pregunta: hacen pedidos para eventos grandes o catering?
   Respuesta: Sí, pero para grupos de más de 20 personas mejor cotizamos directo. Escríbenos "catering".
   ```

2. Publícala igual que el Paso 1 (Archivo → Compartir → Publicar en la Web, eligiendo esta
   pestaña y formato CSV) y copia ese segundo link.
3. Pégalo en la variable `GOOGLE_SHEET_APRENDIZAJE_CSV_URL` en Railway (Paso 4).

**¿De dónde salen las preguntas que hay que agregar ahí?** Cada vez que el bot no sabe
contestar algo, se queda anotado automáticamente en un archivo llamado
`casos-dificiles.json` dentro de la carpeta del bot. Revisa ese archivo una vez a la
semana (tú, o el dueño si le enseñas), y por cada caso real que valga la pena, agrega
una fila nueva en la pestaña "Aprendizaje". Así el bot va cubriendo cada vez más
situaciones, sin tocar código.

---

## Paso 2 — Crear el número de WhatsApp del bot (Meta)

1. Entra a [developers.facebook.com](https://developers.facebook.com) e inicia sesión con
   una cuenta de Facebook (puede ser la del negocio o una tuya, da igual).
2. Da clic en **Mis apps → Crear app**. Elige el tipo **"Negocios"**.
3. Dentro de la app, busca el producto **WhatsApp** y da clic en **Configurar**.
4. Meta te va a dar de forma automática:
   - Un **número de prueba de WhatsApp** (para probar sin gastar).
   - Un **Token de acceso temporal**.
   - Un **ID de número de teléfono** (Phone Number ID).
5. Copia esos 3 datos, los vas a necesitar en el Paso 5.
6. En la sección de "Destinatarios de prueba", agrega tu propio número de WhatsApp
   personal para poder probar el bot contigo mismo primero.

> El token temporal dura 24 horas. Cuando el bot ya esté listo para producción, en esa misma
> pantalla hay un botón para generar un **token permanente** (te pide verificar el negocio
> con Meta Business — tarda uno o dos días, es normal, hazlo desde el día 1).

---

## Paso 3 — Conseguir la llave de Claude (Anthropic)

1. Entra a [console.anthropic.com](https://console.anthropic.com) y crea una cuenta.
2. Ve a **API Keys → Create Key**. Copia esa llave (empieza con `sk-ant-...`).
3. Carga unos dólares de saldo (con $5-10 USD el negocio chico opera cómodo varios meses).

---

## Paso 4 — Subir el bot a Railway (para que esté prendido 24/7)

1. Entra a [railway.app](https://railway.app) y crea una cuenta (puedes usar tu cuenta de
   GitHub o tu correo).
2. Da clic en **New Project → Deploy from GitHub repo** (si no tienes el código en GitHub
   todavía, Railway también te deja subir la carpeta directo con su botón "Empty Project"
   y luego arrastrando los archivos — pero lo más simple es pedirle a quien te ayudó a armar
   el bot que lo suba a GitHub por ti, es un paso de 2 minutos para alguien con experiencia).
3. Una vez creado el proyecto, ve a la pestaña **Variables** y agrega, una por una, TODAS
   las variables que están en el archivo `.env.example`:

   | Variable | De dónde sale |
   |---|---|
   | `WHATSAPP_TOKEN` | Paso 2 |
   | `WHATSAPP_PHONE_NUMBER_ID` | Paso 2 |
   | `WHATSAPP_VERIFY_TOKEN` | La inventas tú (ej: `cafelaesquina2026`) |
   | `ANTHROPIC_API_KEY` | Paso 3 |
   | `NOMBRE_NEGOCIO` | El nombre real del negocio |
   | `OWNER_WHATSAPP_NUMBER` | El WhatsApp del dueño, con código de país, ej: `5215512345678` |
   | `GOOGLE_SHEET_CSV_URL` | Paso 1 |
   | `GOOGLE_SHEET_APRENDIZAJE_CSV_URL` | Paso 1b (opcional, se puede dejar vacío al inicio) |
   | `TOKEN_DASHBOARD` | La inventas tú (ej: `cafelaesquina_panel_2026`) |
   | `URL_PUBLICA_DEL_SERVIDOR` | Déjala vacía por ahora, se llena en el Paso 4b |

4. Railway va a instalar todo y prender el bot solo. Cuando termine, arriba te da una URL
   pública, algo como `https://tu-bot.up.railway.app`.

## Paso 4b — Terminar de configurar el dashboard de tickets

Ahora que ya tienes la URL de Railway, regresa a la pestaña **Variables** y edita
`URL_PUBLICA_DEL_SERVIDOR` para que sea exactamente esa URL (sin `/` al final), por
ejemplo `https://tu-bot.up.railway.app`. Railway va a reiniciar el bot solo con el
nuevo valor. Esto es lo que le permite al bot armar los links de "en revisión"/"resuelto"
que le manda al dueño cuando hay un ticket nuevo (ver sección "El dashboard de tickets"
más abajo).

---

## Paso 5 — Conectar Meta con tu bot (configurar el webhook)

1. Vuelve al panel de Meta for Developers, dentro de tu app, sección **WhatsApp → Configuration**.
2. En "Webhook", da clic en **Edit** y llena:
   - **Callback URL:** `https://tu-bot.up.railway.app/webhook` (la URL de Railway + `/webhook`)
   - **Verify token:** el mismo que inventaste en `WHATSAPP_VERIFY_TOKEN`
3. Da clic en **Verify and Save**. Si todo está bien, Meta lo acepta al instante (si da
   error, ve a la sección "Se rompió, ¿ahora qué?" más abajo).
4. Justo abajo, en "Webhook fields", activa (suscríbete a) el campo **messages**.

---

## Paso 6 — Probar el bot

1. Desde tu WhatsApp personal (el que agregaste como "destinatario de prueba" en el Paso 2),
   mándale un mensaje al número de WhatsApp del bot: por ejemplo, "¿cuál es su horario?".
2. En unos segundos debe contestarte automáticamente con la información real del Google Sheet.
3. Prueba también hacer un pedido: "quiero 2 cafés americanos para llevar, soy Erika, paso
   a las 5pm" — debe confirmarte el pedido y avisarle al dueño por WhatsApp.
4. Prueba algo raro a propósito, como una queja o algo que no está en el menú — el bot debe
   decir que en un momento te contesta una persona, y avisarle al dueño.

Si los 3 casos funcionan, el bot está listo para producción. Solo falta que el dueño mande
su número de WhatsApp real a Meta para "salir de modo prueba" (esto lo hace Meta Business
Verification, tarda 1-2 días, y es sin costo).

---

## El dashboard de tickets (casos escalados a un humano)

Cada vez que el bot no puede resolver algo solo (una queja, un pedido grande, algo
urgente, o cualquier duda fuera de lo que sabe), se crea un **ticket** y el dueño recibe
un WhatsApp así:

```
🚨 ALTA | QUEJA | Ticket TK-20260910-151042-3
Cliente: 5215512345678
Mensaje: "el café llegó frío otra vez"

Marcar en revisión: https://tu-bot.up.railway.app/ticket/TK-.../revisar?token=...
Responder y resolver: https://tu-bot.up.railway.app/ticket/TK-.../resolver?token=...
```

El dueño solo toca el link correspondiente desde su celular:
- **Marcar en revisión** — avisa que ya lo está atendiendo (no le manda nada al cliente).
- **Responder y resolver** — abre una pantalla sencilla donde el dueño VE lo que escribió
  el cliente y escribe su propia respuesta en una caja de texto. Al enviarla, esa
  respuesta (tal cual, no un mensaje genérico) se le manda al cliente por WhatsApp y el
  ticket queda cerrado. Esto es clave para preguntas como "¿hay lugar ahorita?" — el bot
  le dice al cliente que lo va a confirmar con el negocio, y cuando el dueño responde
  desde este link, esa respuesta específica es la que le llega al cliente.

Para ver TODOS los tickets (pendientes, en revisión, resueltos) con métricas generales,
visita desde cualquier navegador:

```
https://tu-bot.up.railway.app/tickets?token=EL_TOKEN_DASHBOARD_QUE_INVENTASTE
```

Guarda ese link — es el "panel de control" del negocio. Sin el `?token=...` correcto,
la página no se abre (para que nadie más pueda verla).

---

## Avisos al dueño fuera de la ventana de 24 horas (plantilla de respaldo)

Los avisos al dueño (ticket nuevo, pedido nuevo) los inicia el bot, no son respuesta a
algo que el dueño acaba de escribir. WhatsApp **solo permite texto libre y botones si el
dueño le escribió al número del bot en las últimas 24 horas**. Pasado ese tiempo Meta
rechaza el mensaje (error `131047`, "Re-engagement message"), y el dueño no se entera.

Por eso el bot funciona así (función `avisarAlDueno` en `whatsapp.js`):

1. Intenta primero el texto y los botones de siempre.
2. Si eso falla por cualquier motivo, reintenta **una vez** con una plantilla aprobada por
   Meta (la de abajo).
3. Guarda el resultado (`ENVIADO`/`FALLIDO`, la hora y el error) en el ticket o pedido. Si
   el aviso no llegó por ningún medio, en `/tickets` y en `/pedidos` aparece la marca
   **⚠️ Aviso al dueño no llegó** junto al ticket o pedido (al pasar el cursor se ve el
   motivo).

La plantilla es opcional, pero **sin ella los avisos fuera de la ventana de 24 h siguen sin
llegar** (ahora al menos quedan marcados en el dashboard y en los logs de Railway).

### Crear la plantilla en Meta

1. Entra a [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates)
   (o desde tu app de Meta for Developers → WhatsApp → Message Templates).
2. Crea la plantilla con estos datos:

   | Campo | Valor |
   |---|---|
   | Nombre | `aviso_dueno` (o el que prefieras; va en `WHATSAPP_PLANTILLA_AVISO_DUENO`) |
   | Categoría | **Utility** (es un aviso de servicio al dueño, no publicidad) |
   | Idioma | Spanish (MEX) — `es_MX` (o el de `WHATSAPP_IDIOMA_PLANTILLA`) |
   | Botones | Ninguno |

   **Texto del cuerpo:**
   > Hola, tienes un nuevo aviso de {{1}} en tu negocio. Resumen: {{2}}. Revísalo aquí: {{3}} Este es un mensaje automático.

   **Parámetros** (el orden tiene que coincidir con el que manda el código):

   | Variable | Qué lleva | Valor de ejemplo para enviar a Meta |
   |---|---|---|
   | `{{1}}` | Tipo de aviso | `ticket` |
   | `{{2}}` | Resumen del aviso, en **una sola línea** y de **máximo 200 caracteres** | `ALTA \| QUEJA \| Ticket TK-20260910-151042-3 \| Cliente: 5215512345678 \| Mensaje: "el café llegó frío otra vez"` |
   | `{{3}}` | Link para ver el detalle (el dashboard). En los avisos de pedido va un guion `—`, porque no llevan link | `https://tu-bot.up.railway.app/conversacion?numero=5215512345678&token=abc123` |

   Notas:
   - El cuerpo empieza y termina con texto fijo (Meta rechaza o reclasifica como Marketing
     las plantillas que empiezan o terminan con una variable, o que casi no tienen texto
     fijo). Si cambias el texto, conserva eso.
   - Meta no acepta saltos de línea, tabs ni más de 4 espacios seguidos dentro de una
     variable: el bot junta el resumen en una sola línea (separado con ` | `) antes de
     enviarlo. Si el resumen pasa de 200 caracteres se recorta (sin dejar un link a
     medias). El link de `{{3}}` nunca se recorta.
   - Por la vía de plantilla el dueño recibe **un solo link** (a la conversación con el
     cliente). Los botones "Marcar en revisión" / "Marcar resuelto" solo llegan por la vía
     normal. Con la plantilla, desde la conversación toca "← Tickets": en esa lista están
     los mismos "Marcar en revisión" y "Marcar como resuelto".
   - Meta puede reclasificar la plantilla de Utility a Marketing si le parece
     promocional. Revisa la categoría en WhatsApp Manager cuando la aprueben.

3. Manda la plantilla a aprobación (tarda desde unas horas hasta 1-2 días). Mientras no
   esté aprobada **no se puede usar**.
4. En Railway, agrega estas variables:

   | Variable | Valor |
   |---|---|
   | `WHATSAPP_PLANTILLA_AVISO_DUENO` | el nombre EXACTO de la plantilla (ej. `aviso_dueno`) |
   | `WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA` | `false` hasta que Meta la marque **"Approved"**; recién entonces `true` |
   | `WHATSAPP_IDIOMA_PLANTILLA` | el idioma con el que la creaste (ej. `es_MX`) |

   **La bandera `_APROBADA` empieza en `false` a propósito** (mismo patrón que la plantilla
   de reseñas): mientras esté así el bot nunca intenta mandar la plantilla, porque un envío
   real contra una plantilla que Meta no aprobó afecta la calidad del número de WhatsApp
   Business.

---

## Plantilla de WhatsApp para la solicitud de reseña (Motor B)

Este bot no manda recordatorios de anticipación (Motor A no aplica: las recogidas son el
mismo día). Solo manda, un rato después de marcar el pedido como entregado, una solicitud
de reseña de Google (`ACTIVAR_SOLICITUD_RESENA`). Eso ocurre normalmente fuera de la
ventana de 24 h de Meta, así que exige una **plantilla de mensaje aprobada**; sin ella no
sale nada (el bot no truena, solo lo anota en los logs de Railway).

1. Entra a [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates)
   (WABA de este cliente) y crea la plantilla `solicitud_resena`: **categoría "Utility"**
   (no "Marketing"), idioma **Spanish (MEX)** (`es_MX`, o el de `WHATSAPP_IDIOMA_PLANTILLA`),
   sin botones ni footer:

   > ¡Hola {{1}}! Gracias por visitar {{2}}. Si te gustó tu experiencia, ¿nos ayudarías con una breve reseña en Google? {{3}} ¡Gracias!

   Parámetros (en este orden exacto, ver `seguimientoPostEvento.js`): `{{1}}` = nombre del
   cliente (ej. `Vale`; si no se tiene, el bot manda "cliente"), `{{2}}` = `NOMBRE_NEGOCIO`
   (ej. `Café Aroma`), `{{3}}` = link de reseña de Google (ej. `https://g.page/r/prueba123/review`).
   El cierre "¡Gracias!" es obligatorio: Meta rechaza una plantilla que termine en una variable.
2. Manda a aprobación (de unas horas a 1-2 días) y revisa que Meta la deje en **Utility**.
3. En Railway:

   | Variable | Valor |
   |---|---|
   | `ACTIVAR_SOLICITUD_RESENA` | `true` para activar |
   | `WHATSAPP_PLANTILLA_RESENA` | `solicitud_resena` |
   | `WHATSAPP_PLANTILLA_RESENA_APROBADA` | `false` hasta que Meta la marque "Approved"; recién entonces `true` |
   | `RESENA_ESPERA_HORAS` | horas de espera tras marcar el pedido como entregado (`0.5` = 30 min) |
   | `WHATSAPP_IDIOMA_PLANTILLA` | el idioma con el que la creaste (ej. `es_MX`) |

   La bandera `..._APROBADA` empieza en `false` a propósito: mientras no esté en `true`, el
   bot nunca intenta mandar la plantilla (un envío contra una no aprobada afecta la
   reputación del número).

### El link de reseña de Google

En la pestaña de información del negocio del Sheet agrega la fila con el link (acepta una
sola celda `Link de reseña Google: https://...`, o dos columnas `Link de reseña Google` |
`https://...`). Solo se acepta un link de **Google** (`google.com`, `g.page`, `goo.gl` o
`maps.app.goo.gl`); cualquier otro se trata como si la fila estuviera vacía.

- Si falta o es inválido, la reseña no se manda y el bot le avisa **una sola vez** al dueño
  por WhatsApp (aviso tipo `CONFIG`); no lo repite en cada ciclo. Al corregir el link, el
  aviso se rearma solo.
- Solo se piden reseñas de pedidos entregados hace **menos de 48 horas**; los más viejos
  se ignoran.

## Cómo el dueño del negocio actualiza su información (sin tocar código)

Solo tiene que editar el Google Sheet del Paso 1 y guardar. El bot lee los cambios
automáticamente dentro de los siguientes 10 minutos. Nada más que hacer.
