# Pruebas de regresión

Se corren con `node tests/run-all.js` (o un archivo suelto: `node tests/busqueda.test.js`).

- No usan red: las fuentes (data912, ArgentinaDatos, CoinGecko, dolarapi) están simuladas.
- No modifican nada del proyecto.
- Esta carpeta está en `.vercelignore`: no se despliega.

| Archivo | Qué cubre |
|---|---|
| `motor-precios.test.js` | Normalización de precios (factor, MEP, rechazos) y respuestas de catálogo y API |
| `fase1-ruta-vieja.test.js` | La ruta vieja respeta precios manuales y posiciones vinculadas |
| `ids-multiples.test.js` | `/api/precios?ids=` con 1, 2, 3, 5, 17 y 120 ids, espacios, `+`, `%20`, `%2C`, repetidos y vacíos |
| `catalogo-reglas.test.js` | Reglas por tipo y proveedor, evidencia, CONFIRMADO / CONTRASTADO / PENDIENTE, AUTOMÁTICO / MANUAL |
| `herencia-reglas.test.js` | Una regla validada por clase no puede heredarse a otro proveedor, panel, moneda, unidad o factor, ni a variantes D/C, otras familias de bonos, ONs, letras ni FCI (incluye estrés sobre el catálogo completo) |
| `fci-ids.test.js` | Ids estables provisionales de FCI, equivalencias, colisiones y asociaciones explícitas |
| `busqueda.test.js` | Búsqueda por símbolo, nombre y alias curados |
| `alcance-fase2b.test.js` | Lo que NO debe cambiar (index.html, ruta vieja, byma-test), exclusión del despliegue y tamaño del catálogo |

`alcance-fase2b.test.js` compara contra el commit `8f56573` (fin de la Fase 1). Cuando una fase posterior cambie
`index.html` a propósito, hay que actualizar esa referencia.
