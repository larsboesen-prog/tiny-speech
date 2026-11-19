# The recognizer's name hint, per city and language

Made by `tools/hint-report.mjs` with Whisper's own tokenizers; budget 220 tokens (Whisper reads at most 223). The page sends
the names in this order and the speech worker packs them with the same count (`browser/asr-worker.js`); a name that does not
fit is still found afterwards by sound matching.

## San Miguel de Allende (mx-sma), en: 51 names, 218 tokens (onnx-community/whisper-tiny.en)

Centro, Jardín, Susan York, Jacques, Lavanda, Santa Ana, Café Umarán, K'ibok, Amapola, Zenteno, Buonforno, Rústica, El Maple, Luna de Queso, Nieves, Don Tomás, La Mancha, Oratorio, Hierba Santa, Arriba y Abajo, Andanza, Agavia, Tostévere, San Mezcal, Olas Altas, Bocaciega, La Cabra Iluminada, Casa Nostra, Fenicia, La Parada, Lima, Sushi Gami, La Chope, La Hija del Manantial, La Azotea, Selina, Sautto, La Frontera, Estoril, Zumo, Trino, Birria Xalisco, El Rinconcito, Nudol, Cien 24, Sikelia, Casa Giovanni, El Vergel, Garambullo, Viñedo, Raíces.

Did not fit (45): Quesadillas, Esquites, Esquites y mollejitas, Market tamales, TorrArt Café, Amor & Cacao, Bacal, Kan Bei, Ghar, Carnitas El Güero, El Pato Barbacoa y Mixiotes, Mariscos Los Delfines, El Puerto Seafood, Mercado Ignacio Ramírez, Petit Four, Café Rama, Churrería San Agustín, Panadería La Buena Vida, Áperi, Quince Rooftop, Fátima 7 Rooftop, Terraza La Vista, Bennu, Tío Lucas, Panadería La Colmena, Mama Mía, Raindog Cantina, Johnny's Piano Bar, Parroquia de San Miguel Arcángel, Jardín Principal, Museo Casa de Allende, Bellas Artes · El Nigromante, Templo de la Concepción, Biblioteca Pública, Templo de San Francisco, Oratorio de San Felipe Neri, Mercado de Artesanías, Parque Juárez, Plaza de Toros, Instituto Allende, El Mirador, El Charco del Ingenio, Fábrica La Aurora, Santuario de Atotonilco, Casa Europa.

## San Miguel de Allende (mx-sma), es: 52 names, 220 tokens (onnx-community/whisper-tiny)

Centro, Jardín, Susan York, Jacques, Lavanda, Santa Ana, Café Umarán, K'ibok, Amapola, Zenteno, Buonforno, Rústica, El Maple, Luna de Queso, Nieves, Don Tomás, La Mancha, Oratorio, Hierba Santa, Arriba y Abajo, Andanza, Agavia, Tostévere, San Mezcal, Olas Altas, Bocaciega, La Cabra Iluminada, Casa Nostra, Fenicia, La Parada, Lima, Sushi Gami, La Chope, La Hija del Manantial, La Azotea, Selina, Sautto, La Frontera, Estoril, Zumo, Trino, Birria Xalisco, El Rinconcito, Nudol, Cien 24, Sikelia, Casa Giovanni, El Vergel, Garambullo, Viñedo, Raíces, Quesadillas.

Did not fit (44): Esquites, Esquites y mollejitas, Market tamales, TorrArt Café, Amor & Cacao, Bacal, Kan Bei, Ghar, Carnitas El Güero, El Pato Barbacoa y Mixiotes, Mariscos Los Delfines, El Puerto Seafood, Mercado Ignacio Ramírez, Petit Four, Café Rama, Churrería San Agustín, Panadería La Buena Vida, Áperi, Quince Rooftop, Fátima 7 Rooftop, Terraza La Vista, Bennu, Tío Lucas, Panadería La Colmena, Mama Mía, Raindog Cantina, Johnny's Piano Bar, Parroquia de San Miguel Arcángel, Jardín Principal, Museo Casa de Allende, Bellas Artes · El Nigromante, Templo de la Concepción, Biblioteca Pública, Templo de San Francisco, Oratorio de San Felipe Neri, Mercado de Artesanías, Parque Juárez, Plaza de Toros, Instituto Allende, El Mirador, El Charco del Ingenio, Fábrica La Aurora, Santuario de Atotonilco, Casa Europa.

## Villa Ejemplo (xx-test), en: 14 names, 95 tokens (onnx-community/whisper-tiny.en)

Café Brújula, Arepas Doña Lucero, Fonda del Puerto, Terraza Volcán, Pizzería Nápoles Chica, La Ribera Jazz, The Garden, Panadería Trigal, Sushi Marea, Viñedo Las Nubes, Tacos El Faro, Café de la Ribera, Plaza Mayor de Villa Ejemplo, Catedral de Santa Prueba.

Did not fit (0): none.

## Villa Ejemplo (xx-test), es: 14 names, 95 tokens (onnx-community/whisper-tiny)

Café Brújula, Arepas Doña Lucero, Fonda del Puerto, Terraza Volcán, Pizzería Nápoles Chica, La Ribera Jazz, The Garden, Panadería Trigal, Sushi Marea, Viñedo Las Nubes, Tacos El Faro, Café de la Ribera, Plaza Mayor de Villa Ejemplo, Catedral de Santa Prueba.

Did not fit (0): none.
