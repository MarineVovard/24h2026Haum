const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect('mongodb://127.0.0.1:27017/marabunta')
  .then(() => console.log('✅ Connecté à MongoDB !!!'))
  .catch(err => {
    console.error('❌ Erreur de connexion MongoDB', err.message);
    process.exit(1);
  });

const sessionSchema = new mongoose.Schema({
  sessionId: Number,
  startedAt: Number,
  team: String
});

// Schéma du Log pensé pour faciliter le Replay
const logSchema = new mongoose.Schema({
  sessionId: Number,
  timestamp: Number,
  vesselId: String,
  type: String,       // ex: 'move', 'active_scan', 'damage', 'OUT_move'
  position: [Number], // si retourné par le msg
  direction: [Number],// la direction demandée aux actions
  what: String,       // type d'objet scanné ('asteroid', etc.)
  hp: Number,         // pdv restants (en cas de stats ou damage)
  rawMsg: mongoose.Schema.Types.Mixed // Le JSON complet natif
});

const Session = mongoose.model('Session', sessionSchema);
const Log = mongoose.model('Log', logSchema);

// Démarrer une nouvelle partie
app.post('/api/start', async (req, res) => {
  try {
    const { sessionId, team } = req.body;
    const session = new Session({ sessionId, startedAt: Date.now(), team });
    await session.save();
    console.log(`[+] Nouvelle session de jeu enregistrée: ${sessionId}`);
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Enregistrer les événements entrants (InMessage) et sortants (OutMessage)
app.post('/api/log', async (req, res) => {
  try {
    const { sessionId, vesselId, type, msg, isOutCommand } = req.body;
    
    // Extraction pour indexation facile
    let position = msg.position ?? msg.movement ?? null;
    let what = msg.what || null;
    let hp = msg.hp || null;
    let direction = msg.direction || null;
    
    // Différencie si le log vient d'une action qu'on a lancée (OUT) ou d'un évènement serveur
    const finalType = isOutCommand ? `OUT_${type}` : type;

    const log = new Log({
      sessionId,
      timestamp: Date.now(),
      vesselId,
      type: finalType,
      position,
      direction,
      what,
      hp,
      rawMsg: msg
    });
    
    await log.save();
    res.send({ success: true });
  } catch(err) {
    res.status(500).send({ error: err.message });
  }
});

app.listen(3000, () => {
   console.log('🚀 Serveur de logging MongoDB prêt sur http://localhost:3000');
   console.log("   Assurez-vous qu'un serveur MongoDB local tourne sur le port 27017.");
});
