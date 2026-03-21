import { SmartNavigation } from './src/app/services/smart-navigation';

function runTests() {
  console.log('=== DÉBUT DES TESTS DE NAVIGATION ===\n');

  // Test 1: Ligne droite dégagée
  console.log('Test 1: Chemin dégagé vers la cible');
  const move1 = SmartNavigation.getNextMoveGreedy(
    [0, 0],   // Départ
    [0, 10],  // Cible (Nord)
    [],       // Pas d'obstacles
    5,        // maxSpeed
    2         // Rayon (non utilisé car pas d'obstacles)
  );
  console.log(`Résultat attendu: direction ~[0, 5]`);
  console.log(`Mouvement calculé: [${move1[0].toFixed(2)}, ${move1[1].toFixed(2)}]\n`);


  // Test 2: Un obstacle bloque pile la ligne droite
  console.log('Test 2: Un obstacle plein centre bloque la route (0, 5) !');
  const obstacles2: [number, number][] = [[0, 5]]; // Obstacle en plein millieu
  const move2 = SmartNavigation.getNextMoveGreedy(
    [0, 0],   // Départ
    [0, 10],  // Cible (Nord)
    obstacles2,
    5,        // maxSpeed
    3,        // Rayon de sécurité important
    32        // 32 angles testés
  );
  console.log(`Résultat attendu: Le vaisseau devrait faire un pas en biais pour esquiver.`);
  console.log(`Mouvement calculé: [${move2[0].toFixed(2)}, ${move2[1].toFixed(2)}]\n`);


  // Test 3: Cible très proche (moins que maxSpeed) mais bloquée. 
  // S'il n'y avait pas d'obstacle, il ferait le saut complet. Sans collision, il saute.
  // Avec collision, il esquive.
  console.log('Test 3: Cible proche (0, 4) bloquée par un mur en (0, 2)');
  const obstacles3: [number, number][] = [[0, 2]];
  const move3 = SmartNavigation.getNextMoveGreedy(
    [0, 0],   // Départ
    [0, 4],   // Cible (Nord)
    obstacles3,
    5,        // maxSpeed (5 > 4 donc il voudrait y aller direct)
    1.5       // Rayon
  );
  console.log(`Résultat attendu: Esquive en diagonale au lieu d'y aller direct.`);
  console.log(`Mouvement calculé: [${move3[0].toFixed(2)}, ${move3[1].toFixed(2)}]\n`);

}

runTests();
