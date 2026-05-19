const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Algoritmo ISM aggiornato con i nuovi parametri granulari
function calcolaISM(dati) {
    const caffeEccessivi = dati.numero_caffe > 4 ? (dati.numero_caffe - 4) * 2 : 0;
    const malusStimolanti = (dati.bevande_stimolanti || 0) * 3;
    const malusAllucinazioni = (dati.allucinazioni || 0) * 10; // Le allucinazioni pesano molto!
    
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

// 1. POST /api/aggiornamento -> Salva il nuovo monitoraggio completo
app.post('/api/aggiornamento', async (req, res) => {
    const d = req.body;
    try {
        await pool.query(
            `INSERT INTO aggiornamenti_giornalieri 
            (id_utente, ore_sonno, livello_energia, stress, ansia, ore_studio, crisi_esistenziali, 
             numero_caffe, bevande_stimolanti, allucinazioni, copertura_prima_prova, copertura_seconda_prova, copertura_orale) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id_utente, data) DO UPDATE SET
                ore_sonno = EXCLUDED.ore_sonno, livello_energia = EXCLUDED.livello_energia,
                stress = EXCLUDED.stress, ansia = EXCLUDED.ansia, ore_studio = EXCLUDED.ore_studio,
                crisi_esistenziali = EXCLUDED.crisi_esistenziali, numero_caffe = EXCLUDED.numero_caffe,
                bevande_stimolanti = EXCLUDED.bevande_stimolanti, allucinazioni = EXCLUDED.allucinazioni,
                copertura_prima_prova = EXCLUDED.copertura_prima_prova, copertura_seconda_prova = EXCLUDED.copertura_seconda_prova,
                copertura_orale = EXCLUDED.copertura_orale`,
            [d.id_utente, d.ore_sonno, d.livello_energia, d.stress, d.ansia, d.ore_studio, d.crisi_esistenziali,
             d.numero_caffe, d.bevande_stimolanti, d.allucinazioni, d.copertura_prima_prova, d.copertura_seconda_prova, d.copertura_orale]
        );
        const risorsaIsm = calcolaISM(d);
        res.status(201).json({ message: "Dati salvati con successo", ism: risorsaIsm });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. GET /api/statistiche -> Medie aggregate + dati per l'andamento del grafico
app.get('/api/statistiche', async (req, res) => {
    try {
        // Medie generali della classe
        const medielRes = await pool.query(`
            SELECT 
                COALESCE(AVG(stress), 0) as stress_medio, COALESCE(AVG(ansia), 0) as ansia_media, 
                COALESCE(AVG(ore_sonno), 0) as sonno_medio, COALESCE(AVG(ore_studio), 0) as studio_medio,
                COALESCE(AVG(numero_caffe), 0) as caffe_medio, COALESCE(AVG(bevande_stimolanti), 0) as stimolanti_medi,
                COALESCE(AVG(allucinazioni), 0) as allucinazioni_medie, COALESCE(AVG(copertura_prima_prova), 0) as p_prova_media,
                COALESCE(AVG(copertura_seconda_prova), 0) as s_prova_media, COALESCE(AVG(copertura_orale), 0) as orale_medio
            FROM aggiornamenti_giornalieri
        `);
        
        // Storico giornaliero medio per il Grafico dell'Andamento ISM
        const storicoRes = await pool.query(`
            SELECT data,
                   AVG(ore_sonno) as ore_sonno, AVG(livello_energia) as livello_energia, 
                   AVG(ore_studio) as ore_studio, AVG(stress) as stress, AVG(ansia) as ansia, 
                   AVG(crisi_esistenziali) as crisi_esistenziali, AVG(numero_caffe) as numero_caffe,
                   AVG(bevande_stimolanti) as bevande_stimolanti, AVG(allucinazioni) as allucinazioni
            FROM aggiornamenti_giornalieri
            GROUP BY data ORDER BY data ASC LIMIT 15
        `);

        // Calcola l'andamento ISM medio per ogni giorno registrato
        const andamentoGrafico = storicoRes.rows.map(row => {
            const ismGiorno = calcolaISM({
                ore_sonno: parseFloat(row.ore_sonno), livello_energia: parseFloat(row.livello_energia),
                ore_studio: parseFloat(row.ore_studio), stress: parseFloat(row.stress), ansia: parseFloat(row.ansia),
                crisi_esistenziali: parseFloat(row.crisi_esistenziali), numero_caffe: parseFloat(row.numero_caffe),
                bevande_stimolanti: parseFloat(row.bevande_stimolanti), allucinazioni: parseFloat(row.allucinazioni)
            });
            return {
                data: row.data.toISOString().split('T')[0],
                valore: ismGiorno.valore
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

// 3. POST e GET Messaggi (Inalterati per il muro)
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
