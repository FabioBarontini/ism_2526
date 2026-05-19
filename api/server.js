const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Funzione matematica per calcolare l'ISM
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

// POST /api/aggiornamento -> Salva una nuova rilevazione istantanea
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

// GET /api/statistiche -> Ritorna le medie globali e la lista dei punti temporali per il grafico
app.get('/api/statistiche',
