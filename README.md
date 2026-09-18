# Barshi Turnos

Sitio de reservas de Barshi Barber.

## Sitio público
GitHub Pages publica `index.html`.

## Base de datos con Supabase
1. Crear un proyecto en Supabase.
2. Abrir **SQL Editor**.
3. Copiar y ejecutar `supabase/schema.sql`.
4. Ir a **Project Settings > Data API** y copiar:
   - Project URL
   - Publishable key
5. Copiar `config.example.js` como `config.js` y completar esos dos valores.

> La clave pública/publishable sí puede usarse en el navegador cuando RLS está configurado correctamente. No usar nunca la service_role key en el frontend.

## Tablas
- services
- professionals
- professional_services
- clients
- appointments
- settings

## Próximos pasos
- conectar el frontend a Supabase;
- agregar acceso administrativo con Supabase Auth;
- evitar doble reserva por profesional/horario;
- conectar WhatsApp Business Cloud API para confirmación y recordatorios.
