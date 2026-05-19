const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

// Configurazione del pool di connessione a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Obbligatorio per servizi cloud come Neon o Supabase
  }
});

// Logica di calcolo dell'ISM (immutata rispetto alla tua)
function calcolaISM(dati) {
    const caffeEccessivi = dati.numero_caffe > 4 ? (dati.numero_caffe - 4) * 2 : 0;
    let score = (dati.ore_sonno * 2) 
                + (dati.livello_energia * 3) 
                + (dati.ore_studio) 
                - (dati.stress * 2) 
                - (dati.ansia * 2) 
                - (dati.crisi_esistenziali) 
                - caffeEccessivi;

    let ismFinale = Math.min(100, Math.max(0, Math.round(((score + 40) / 100) * 100)));
    
    let stato = "";
    if (ismFinale <= 30) stato = "COLLASSO IMMINENTE";
    else if (ismFinale <= 60) stato = "SITUAZIONE CRITICA";
    else if (ismFinale <= 80) stato = "SOPRAVVIVENZA PROBABILE";
    else stato = "ESSERE LEGGENDARIO";

    return { valore: ismFinale, stato: stato };
}

// 1. POST /api/aggiornamento -> Salva l'aggiornamento giornaliero nel DB
app.post('/api/aggiornamento', async (req, res) => {
    const d = req.body;
    try {
        await pool.query(
            `INSERT INTO aggiornamenti_giornalieri 
            (id_utente, ore_sonno, livello_energia, stress, ansia, numero_caffe, ore_studio, crisi_esistenziali) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [d.id_utente, d.ore_sonno, d.livello_energia, d.stress, d.ansia, d.numero_caffe, d.ore_studio, d.crisi_esistenziali]
        );
        const risorsaIsm = calcolaISM(d);
        res.status(201).json({ message: "Dati salvati", ism: risorsaIsm });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. GET /api/indice/:id_utente -> Recupera l'ultimo indice calcolato per l'utente dal DB
app.get('/api/indice/:id_utente', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM aggiornamenti_giornalieri 
             WHERE id_utente = $1 
             ORDER BY data DESC, id_aggiornamento DESC LIMIT 1`,
            [req.params.id_utente]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Nessun dato per questo utente" });
        }
        
        res.json(calcolaISM(result.rows[0]));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. GET /api/statistiche -> Calcola le medie globali della classe aggregate
app.get('/api/statistiche', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COALESCE(AVG(stress), 0) as stress_medio, 
                COALESCE(AVG(ansia), 0) as ansia_media, 
                COALESCE(AVG(ore_sonno), 0) as sonno_medio, 
                COALESCE(AVG(ore_studio), 0) as studio_medio 
            FROM aggiornamenti_giornalieri
        `);
        
        const row = result.rows[0];
        res.json({
            stress_medio: parseFloat(row.stress_medio),
            ansia_media: parseFloat(row.ansia_media),
            sonno_medio: parseFloat(row.sonno_medio),
            studio_medio: parseFloat(row.studio_medio)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. POST /api/messaggi -> Salva un messaggio sul muro del DB
app.post('/api/messaggi', async (req, res) => {
    const { id_utente, testo, is_anonimo } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO muro_messaggi (id_utente, testo, is_anonimo) 
             VALUES ($1, $2, $3) RETURNING *`,
            [id_utente || null, testo, is_anonimo || false]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. GET /api/messaggi -> Recupera gli ultimi 50 messaggi unendo i dati dell'utente (se non anonimo)
app.get('/api/messaggi', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, u.nickname 
            FROM muro_messaggi m
            LEFT JOIN utenti u ON m.id_utente = u.id_utente
            ORDER BY m.data_invio DESC LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. GET /api/classifica -> Re del Caffè dal database
app.get('/api/classifica', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id_utente, MAX(numero_caffe) as valore 
            FROM aggiornamenti_giornalieri 
            GROUP BY id_utente 
            ORDER BY valore DESC LIMIT 5
        `);
        res.json({ re_del_caffe: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    const PORT = 3000;
    app.listen(PORT, () => console.log(`Server locale attivo sulla porta ${PORT}`));
}