// Conexión con la base del proyecto en Supabase (solo lectura).
// La clave anon/publishable es pública por diseño: solo permite ejecutar
// la función geoportal_datos(). Si se dejan vacías, se usa datos.geojson.
window.GEOPORTAL_CONFIG = {
    supabaseUrl: 'https://mesrwxpgdfrgkooavjvp.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lc3J3eHBnZGZyZ2tvb2F2anZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Nzg0NDcsImV4cCI6MjEwODI1NDQ0N30.KSCgEdCgapAWkOFf9GqeGJ3YE7EWUQ_IudO04q2sIns'
};
