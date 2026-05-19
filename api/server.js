const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function calcolaISM(dati) {
    const caffeEccessivi = dati.numero_caffe > 4 ? (dati.numero_caffe - 4) * 2 : 0;
    const malusStimolanti = (dati.bevande_stimolanti || 0) * 3;
    const malusAllucinazioni = (dati.allucinazioni || 0) * 10;
    
    let score = (dati.ore_sonno * 2) 
                + (dati.livello_energia * 3) 
                + (dati.ore_studio) 
                - (dati.stress * 2) 
                - (dati.ansia * 2) 
                - (dati.crisi_esistenziali) 
                - caffeEccessivi
                - malusStimolanti
                - malusAllucinazioni;

    let ismFinale = Math.min(100, Math.max(0, Math.round(((score + 40) / 100) * 100)));
    
    let stato = "";
    if (ismFinale <= 30) stato = "COLLASSO IMMINENTE";
    else if (ismFinale <= 60) stato = "SITUAZIONE CRITICA";
    else if (ismFinale <= 80) stato = "SOPRAVVIVENZA PROBABILE";
    else stato = "ESSERE LEGGENDARIO";

    return { valore: ismFinale, stato: stato };
}

// POST /api/aggiornamento
app.post('/api/aggiornamento', async (req, res) => {
    const d = req.body;
    try {
        await pool.query(
            `INSERT INTO aggiornamenti_giornalieri 
            (id_utente, ore_sonno, livello_energia, stress, ansia, ore_studio, crisi_esistenziali, 
             numero_caffe, bevande_stimolanti, allucinazioni, copertura_prima_prova, copertura_seconda_prova, copertura_orale) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [d.id_utente, d.ore_sonno, d.livello_energia, d.stress, d.ansia, d.ore_studio, d.crisi_esistenziali,
             d.numero_caffe, d.bevande_stimolanti, d.allucinazioni, d.copertura_prima_prova, d.copertura_seconda_prova, d.copertura_orale]
        );
        const risorsaIsm = calcolaISM(d);
        res.status(201).json({ message: "Rilevazione registrata", ism: risorsaIsm });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/statistiche
app.get('/api/statistiche', async (req, res) => {
    try {
        const medielRes = await pool.query(`
            SELECT 
                COALESCE(AVG(stress), 0) as stress_medio, COALESCE(AVG(ansia), 0) as ansia_media, 
                COALESCE(AVG(ore_sonno), 0) as sonno_medio, COALESCE(AVG(ore_studio), 0) as studio_medio,
                COALESCE(AVG(numero_caffe), 0) as caffe_medio, COALESCE(AVG(bevande_stimolanti), 0) as stimolanti_medi,
                COALESCE(AVG(allucinazioni), 0) as allucinazioni_medie, COALESCE(AVG(copertura_prima_prova), 0) as p_prova_media,
                COALESCE(AVG(copertura_seconda_prova), 0) as s_prova_media, COALESCE(AVG(copertura_orale), 0) as orale_medio
            FROM aggiornamenti_giornalieri
        `);
        
        const storicoRes = await pool.query(`
            SELECT data_ora, ore_sonno, livello_energia, ore_studio, stress, ansia, 
                   crisi_esistenziali, numero_caffe, bevande_stimolanti, allucinazioni
            FROM aggiornamenti_giornalieri
            ORDER BY data_ora ASC LIMIT 50
        `);

        const andamentoGrafico = storicoRes.rows.map(row => {
            const ismPunto = calcolaISM({
                ore_sonno: row.ore_sonno, livello_energia: row.livello_energia,
                ore_studio: row.ore_studio, stress: row.stress, ansia: row.ansia,
                crisi_esistenziali: row.crisi_esistenziali, numero_caffe: row.numero_caffe,
                bevande_stimolanti: row.bevande_stimolanti, allucinazioni: row.allucinazioni
            });
            return {
                data_ora: row.data_ora.toISOString(), 
                valore: ismPunto.valore
            };
        });

        const r = medielRes.rows[0];
        res.json({
            medie: {
                stress_medio: parseFloat(r.stress_medio), ansia_media: parseFloat(r.ansia_media),
                sonno_medio: parseFloat(r.sonno_medio), studio_medio: parseFloat(r.studio_medio),
                caffe_medio: parseFloat(r.caffe_medio), stimolanti_medi: parseFloat(r.stimolanti_medi),
                allucinazioni_medie: parseFloat(r.allucinazioni_medie),
                copertura: { prima: parseFloat(r.p_prova_media), seconda: parseFloat(r.s_prova_media), orale: parseFloat(r.orale_medio) }
            },
            storico_grafico: andamentoGrafico
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/indice/:id_utente
app.get('/api/indice/:id_utente', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM aggiornamenti_giornalieri WHERE id_utente = $1 ORDER BY data_ora DESC LIMIT 1`,
            [req.params.id_utente]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Nessun dato" });
        res.json(calcolaISM(result.rows[0]));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST e GET Messaggi
app.post('/api/messaggi', async (req, res) => {
    try {
        const result = await pool.query(
            `INSERT INTO muro_messaggi (id_utente, testo, is_anonimo) VALUES ($1, $2, $3) RETURNING *`,
            [req.body.id_utente || null, req.body.testo, req.body.is_anonimo || false]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messaggi', async (req, res) => {
    try {
        const result = await pool.query(`SELECT m.*, u.nickname FROM muro_messaggi m LEFT JOIN utenti u ON m.id_utente = u.id_utente ORDER BY m.data_invio DESC LIMIT 50`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log(`Server locale: http://localhost:3000`));
}
