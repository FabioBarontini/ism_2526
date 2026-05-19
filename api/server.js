const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());

// Configurazione del Pool di connessione a PostgreSQL (compatibile con Vercel)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'super_segreto_chiave_ism_2026';

// Middleware per proteggere le rotte e leggere i dati utente dal Token JWT
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

// NUOVA FORMULA ISM: Bilanciata, Meritocratica e Sensibile a TUTTI gli input
function calcolaISM(dati) {
    // --------------------------------------------------------
    // 1. COMPONENTE SCOLASTICA (Peso: 40% del totale = max 40 punti)
    // --------------------------------------------------------
    const coperturaPrima = parseInt(dati.copertura_prima_prova) || 0;
    const coperturaSeconda = parseInt(dati.copertura_seconda_prova) || 0;
    const coperturaOrale = parseInt(dati.copertura_orale) || 0;
    
    // Media aritmetica della preparazione (da 0 a 100)
    const mediaPreparazione = (coperturaPrima + coperturaSeconda + coperturaOrale) / 3;
    // Proporzione su base 40 punti
    const punteggioScuola = (mediaPreparazione / 100) * 40;

    // --------------------------------------------------------
    // 2. COMPONENTE PSICOFISICA (Peso: 60% del totale = max 60 punti)
    // --------------------------------------------------------
    let punteggioStato = 30; // Base di partenza neutrale (esattamente a metà dei 60 punti)

    // --- BONUS ---
    // Livello energia (1-10): aggiunge fino a +10 punti
    punteggioStato += (parseInt(dati.livello_energia) || 5); 
    
    // Ore studio (0-24): studiare aiuta, ma oltre le 8 ore consecutive subentra il burnout
    const oreStudio = parseInt(dati.ore_studio) || 0;
    if (oreStudio <= 8) {
        punteggioStato += oreStudio * 1.5; // fino a +12 punti bonus
    } else {
        punteggioStato += 12 - (oreStudio - 8) * 1; // Sovraccarico cognitivo: toglie punti dopo le 8 ore
    }

    // Ore sonno (0-24): il sonno ottimale è fissato tra le 7 e le 9 ore
    const oreSonno = parseInt(dati.ore_sonno) || 0;
    if (oreSonno >= 7 && oreSonno <= 9) {
        punteggioStato += 8; // Bonus pieno riposo
    } else if (oreSonno < 5) {
        punteggioStato -= (5 - oreSonno) * 4; // Grave penalità per privazione del sonno
    } else if (oreSonno > 10) {
        punteggioStato -= (oreSonno - 10) * 2; // Letargia/Depressione da stress: riduce l'indice
    }

    // --- PENALITÀ (Fattori Distruttivi) ---
    // Stress (1-10) e Ansia (1-10) sintonizzati sull'impatto psicologico
    punteggioStato -= (parseInt(dati.stress) || 1) * 1.5; 
    punteggioStato -= (parseInt(dati.ansia) || 1) * 1.5;

    // Crisi Esistenziali (0-10)
    punteggioStato -= (parseInt(dati.crisi_esistenziali) || 0) * 2.5;

    // Caffè e Stimolanti (Effetto picco/crollo)
    const caffe = parseInt(dati.numero_caffe) || 0;
    const stimolanti = parseInt(dati.bevande_stimolanti) || 0;
    
    if (caffe <= 3) {
        punteggioStato += caffe * 1; // 1-3 caffè fungono da moderato stimolante positivo
    } else {
        punteggioStato -= (caffe - 3) * 3; // Superata la soglia subentrano tachicardia e ansia chimica
    }
    punteggioStato -= stimolanti * 4; // Energy drink penalizzati pesantemente

    // Allucinazioni visive/uditive (Segno di crollo del sistema)
    punteggioStato -= (parseInt(dati.allucinazioni) || 0) * 12; // Malus drastico e immediato

    // Limitiamo la componente psicofisica in modo rigido nel range di sua competenza (0 - 60 punti)
    punteggioStato = Math.min(60, Math.max(0, punteggioStato));

    // --------------------------------------------------------
    // 3. CALCOLO ISM FINALE (Somma Matematica: max 100)
    // --------------------------------------------------------
    let ismFinale = Math.round(punteggioScuola + punteggioStato);
    ismFinale = Math.min(100, Math.max(0, ismFinale)); // Tolleranza di sicurezza

    // Algoritmo di classificazione dello stato dello studente
    let stato = "";
    if (ismFinale <= 25) stato = "COLLASSO STRUTTURALE (Ritiro immediato)";
    else if (ismFinale <= 50) stato = "SITUAZIONE INSOSTENIBILE (Serve aiuto)";
    else if (ismFinale <= 75) stato = "NAVIGAZIONE A VISTA (In bilico)";
    else stato = "STUDENTE ALPHA (Predestinato al 100)";

    return { valore: ismFinale, stato: stato };
}

/* ==========================================================================
   ROTTE DI AUTENTICAZIONE (REGISTRAZIONE E LOGIN)
   ========================================================================== */

// 1. REGISTRAZIONE UTENTE
app.post('/api/auth/registrazione', async (req, res) => {
    const { username, nickname, nome, classe, password } = req.body;
    try {
        if (!username || !nickname || !password) {
            return res.status(400).json({ error: "I campi Username, Nickname e Password sono obbligatori." });
        }
        
        // Generazione del sale e hashing sicuro della password prima del salvataggio
        const salt = await bcrypt.genSalt(10);
        const passwordHashed = await bcrypt.hash(password, salt);

        const nuovoUtente = await pool.query(
            `INSERT INTO utenti (username, nickname, nome, classe, password) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id_utente, username, nickname`,
            [username, nickname, nome, classe, passwordHashed]
        );
        res.status(201).json({ message: "Registrazione completata con successo!", user: nuovoUtente.rows[0] });
    } catch (err) {
        // Gestione errore vincolo UNIQUE del database Postgres
        if (err.code === '23505') return res.status(400).json({ error: "Username o Nickname già occupati da un altro studente." });
        res.status(500).json({ error: err.message });
    }
});

// 2. LOGIN UTENTE
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM utenti WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Credenziali inserite non valide." });

        const utente = result.rows[0];
        const passwordValida = await bcrypt.compare(password, utente.password);
        if (!passwordValida) return res.status(400).json({ error: "Credenziali inserite non valide." });

        // Generazione del Token di sessione JWT firmato valido per 3 giorni
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


/* ==========================================================================
   ROTTE DEL REPARTO OPERATIVO DELLA DASHBOARD
   ========================================================================== */

// 3. POST /api/aggiornamento (PROTETTA DA TOKEN)
app.post('/api/aggiornamento', autenticaToken, async (req, res) => {
    const d = req.body;
    const id_utente = req.utente.id_utente; // Estrazione automatica e sicura dall'autenticazione JWT
    try {
        await pool.query(
            `INSERT INTO aggiornamenti_giornalieri 
            (id_utente, ore_sonno, livello_energia, stress, ansia, ore_studio, crisi_esistenziali, 
             numero_caffe, bevande_stimolanti, allucinazioni, copertura_prima_prova, copertura_seconda_prova, copertura_orale) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id_utente, d.ore_sonno, d.livello_energia, d.stress, d.ansia, d.ore_studio, d.crisi_esistenziali,
             d.numero_caffe, d.bevande_stimolanti, d.allucinazioni, d.copertura_prima_prova, d.copertura_seconda_prova, d.copertura_orale]
        );
        res.status(201).json({ message: "Rilevazione di stato memorizzata correttamente nel database." });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 4. GET /api/statistiche (PUBBLICA - Consente il disegno dei grafici a tutti)
app.get('/api/statistiche', async (req, res) => {
    try {
        // Calcolo aggregato delle medie globali della classe
        const medielRes = await pool.query(`
            SELECT 
                COALESCE(AVG(stress), 0) as stress_medio, COALESCE(AVG(ansia), 0) as ansia_media, 
                COALESCE(AVG(numero_caffe), 0) as caffe_medio, COALESCE(AVG(bevande_stimolanti), 0) as stimolanti_medi,
                COALESCE(AVG(allucinazioni), 0) as allucinazioni_medie, COALESCE(AVG(copertura_prima_prova), 0) as p_prova_media,
                COALESCE(AVG(copertura_seconda_prova), 0) as s_prova_media, COALESCE(AVG(copertura_orale), 0) as orale_medio
            FROM aggiornamenti_giornalieri
        `);
        
        // Estrazione dello storico temporale per alimentare i punti del grafico lineare ordinato
        const storicoRes = await pool.query(`
            SELECT data_ora, ore_sonno, livello_energia, ore_studio, stress, ansia, crisi_esistenziali, 
                   numero_caffe, bevande_stimolanti, allucinazioni, copertura_prima_prova, 
                   copertura_seconda_prova, copertura_orale 
            FROM aggiornamenti_giornalieri 
            ORDER BY data_ora ASC LIMIT 60
        `);

        // Generazione dell'asse cartesiano calcolando l'ISM puntuale per ogni coordinata storica
        const andamentoGrafico = storicoRes.rows.map(row => ({
            data_ora: row.data_ora.toISOString(), 
            valore: calcolaISM(row).valore // Applica la nuova formula dinamica includendo le coperture
        }));

        const r = medielRes.rows[0];
        res.json({ 
            medie: {
                stress_medio: parseFloat(r.stress_medio), 
                ansia_media: parseFloat(r.ansia_media),
                caffe_medio: parseFloat(r.caffe_medio), 
                stimolanti_medi: parseFloat(r.stimolanti_medi),
                allucinazioni_medie: parseFloat(r.allucinazioni_medie),
                copertura: { 
                    prima: parseFloat(r.p_prova_media), 
                    seconda: parseFloat(r.s_prova_media), 
                    orale: parseFloat(r.orale_medio) 
                }
            }, 
            storico_grafico: andamentoGrafico 
        });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 5. GET /api/indice/:id_utente (PUBBLICA - Fornisce l'ultimo stato calcolato di un singolo utente)
app.get('/api/indice/:id_utente', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM aggiornamenti_giornalieri WHERE id_utente = $1 ORDER BY data_ora DESC LIMIT 1`,
            [req.params.id_utente]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Nessuna registrazione trovata per lo studente." });
        res.json(calcolaISM(result.rows[0]));
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

/* ==========================================================================
   ROTTE DEL MURO DEI MESSAGGI DELLA BACHECA
   ========================================================================== */

// 6. POST /api/messaggi (PROTETTA DA TOKEN)
app.post('/api/messaggi', autenticaToken, async (req, res) => {
    try {
        await pool.query(
            `INSERT INTO muro_messaggi (id_utente, testo, is_anonimo) VALUES ($1, $2, $3)`,
            [req.utente.id_utente, req.body.testo, req.body.is_anonimo || false]
        );
        res.status(201).json({ success: true, message: "Messaggio stampato sul muro!" });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 7. GET /api/messaggi (PUBBLICA)
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

module.exports = app;

// Attivazione server locale per test di sviluppo (Ignorato in produzione su Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log(`Server operativo in locale all'indirizzo: http://localhost:3000`));
}
