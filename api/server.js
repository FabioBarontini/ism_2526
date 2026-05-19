const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'super_segreto_chiave_ism_2026';

// Middleware per proteggere le rotte e leggere l'utente dal Token JWT
function autenticaToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Accesso negato. Token mancante." });

    jwt.verify(token, JWT_SECRET, (err, utente) => {
        if (err) return res.status(403).json({ error: "Token non valido o scaduto." });
        req.utente = utente;
        next();
    });
}

function calcolaISM(dati) {
    const caffeEccessivi = dati.numero_caffe > 4 ? (dati.numero_caffe - 4) * 2 : 0;
    const malusStimolanti = (dati.bevande_stimolanti || 0) * 3;
    const malusAllucinazioni = (dati.allucinazioni || 0) * 10;
    
    let score = (dati.ore_sonno * 2) + (dati.livello_energia * 3) + (dati.ore_studio) 
                - (dati.stress * 2) - (dati.ansia * 2) - (dati.crisi_esistenziali) 
                - caffeEccessivi - malusStimolanti - malusAllucinazioni;

    return Math.min(100, Math.max(0, Math.round(((score + 40) / 100) * 100)));
}

/* --- ROTTE DI AUTENTICAZIONE --- */

// 1. REGISTRAZIONE
app.post('/api/auth/registrazione', async (req, res) => {
    const { username, nickname, nome, classe, password } = req.body;
    try {
        if(!username || !nickname || !password) {
            return res.status(400).json({ error: "Compila tutti i campi obbligatori." });
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHashed = await bcrypt.hash(password, salt);

        const nuovoUtente = await pool.query(
            `INSERT INTO utenti (username, nickname, nome, classe, password) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id_utente, username, nickname`,
            [username, nickname, nome, classe, passwordHashed]
        );
        res.status(201).json({ message: "Registrazione completata!", user: nuovoUtente.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: "Username o Nickname già in uso." });
        res.status(500).json({ error: err.message });
    }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM utenti WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Credenziali errate." });

        const utente = result.rows[0];
        const passwordValida = await bcrypt.compare(password, utente.password);
        if (!passwordValida) return res.status(400).json({ error: "Credenziali errate." });

        // Generazione Token
        const token = jwt.sign(
            { id_utente: utente.id_utente, username: utente.username, nickname: utente.nickname },
            JWT_SECRET,
            { expiresIn: '72h' }
        );

        res.json({ token: token, nickname: utente.nickname });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


/* --- ROTTE OPERATIVE PROTEGGE DA AUTENTICATOKEN --- */

// 3. POST /api/aggiornamento (PROTETTA)
app.post('/api/aggiornamento', autenticaToken, async (req, res) => {
    const d = req.body;
    const id_utente = req.utente.id_utente; // Preso in automatico dal token sicuro
    try {
        await pool.query(
            `INSERT INTO aggiornamenti_giornalieri 
            (id_utente, ore_sonno, livello_energia, stress, ansia, ore_studio, crisi_esistenziali, 
             numero_caffe, bevande_stimolanti, allucinazioni, copertura_prima_prova, copertura_seconda_prova, copertura_orale) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id_utente, d.ore_sonno, d.livello_energia, d.stress, d.ansia, d.ore_studio, d.crisi_esistenziali,
             d.numero_caffe, d.bevande_stimolanti, d.allucinazioni, d.copertura_prima_prova, d.copertura_seconda_prova, d.copertura_orale]
        );
        res.status(201).json({ message: "Rilevazione salvata" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. GET /api/statistiche (PUBBLICA - per vedere i grafici globali anche senza scrivere)
app.get('/api/statistiche', async (req, res) => {
    try {
        const medielRes = await pool.query(`
            SELECT 
                COALESCE(AVG(stress), 0) as stress_medio, COALESCE(AVG(ansia), 0) as ansia_media, 
                COALESCE(AVG(numero_caffe), 0) as caffe_medio, COALESCE(AVG(bevande_stimolanti), 0) as stimolanti_medi,
                COALESCE(AVG(allucinazioni), 0) as allucinazioni_medie, COALESCE(AVG(copertura_prima_prova), 0) as p_prova_media,
                COALESCE(AVG(copertura_seconda_prova), 0) as s_prova_media, COALESCE(AVG(copertura_orale), 0) as orale_medio
            FROM aggiornamenti_giornalieri
        `);
        
        const storicoRes = await pool.query(`
            SELECT data_ora, ore_sonno, livello_energia, ore_studio, stress, ansia, crisi_esistenziali, numero_caffe, bevande_stimolanti, allucinazioni FROM aggiornamenti_giornalieri ORDER BY data_ora ASC LIMIT 60
        `);

        const andamentoGrafico = storicoRes.rows.map(row => ({
            data_ora: row.data_ora.toISOString(), 
            valore: calcolaISM({
                ore_sonno: row.ore_sonno, livello_energia: row.livello_energia, ore_studio: row.ore_studio,
                stress: row.stress, ansia: row.ansia, crisi_esistenziali: row.crisi_esistenziali,
                numero_caffe: row.numero_caffe, bevande_stimolanti: row.bevande_stimolanti, allucinazioni: row.allucinazioni
            })
        }));

        res.json({ medie: {
            stress_medio: parseFloat(medielRes.rows[0].stress_medio), ansia_media: parseFloat(medielRes.rows[0].ansia_media),
            caffe_medio: parseFloat(medielRes.rows[0].caffe_medio), stimolanti_medi: parseFloat(medielRes.rows[0].stimolanti_medi),
            allucinazioni_medie: parseFloat(medielRes.rows[0].allucinazioni_medie),
            copertura: { prima: parseFloat(medielRes.rows[0].p_prova_media), seconda: parseFloat(medielRes.rows[0].s_prova_media), orale: parseFloat(medielRes.rows[0].orale_medio) }
        }, storico_grafico: andamentoGrafico });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. POST /api/messaggi (PROTETTA)
app.post('/api/messaggi', autenticaToken, async (req, res) => {
    try {
        await pool.query(
            `INSERT INTO muro_messaggi (id_utente, testo, is_anonimo) VALUES ($1, $2, $3)`,
            [req.utente.id_utente, req.body.testo, req.body.is_anonimo || false]
        );
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. GET /api/messaggi (PUBBLICA)
app.get('/api/messaggi', async (req, res) => {
    try {
        const result = await pool.query(`SELECT m.*, u.nickname FROM muro_messaggi m LEFT JOIN utenti u ON m.id_utente = u.id_utente ORDER BY m.data_invio DESC LIMIT 50`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;
