class SmartNavigation {
  static getNextMoveGreedy(current, target, obstacles, maxSpeed, obstacleRadius = 5.0, numAngles = 32) {
    const distToTarget = this.distance(current, target);
    if (distToTarget <= maxSpeed) {
      if (!this.checkCollision(current, target, obstacles, obstacleRadius)) {
        return [target[0] - current[0], target[1] - current[1]];
      }
    }
    let bestMove = [0, 0];
    let minTargetDist = Infinity;
    let foundValidMove = false;
    for (let i = 0; i < numAngles; i++) {
      const angle = (i * 2 * Math.PI) / numAngles;
      const dx = Math.cos(angle) * maxSpeed;
      const dy = Math.sin(angle) * maxSpeed;
      const proposedPos = [current[0] + dx, current[1] + dy];
      if (!this.checkCollision(current, proposedPos, obstacles, obstacleRadius)) {
        const dist = this.distance(proposedPos, target);
        if (dist < minTargetDist) {
          minTargetDist = dist;
          bestMove = [dx, dy];
          foundValidMove = true;
        }
      }
    }
    if (foundValidMove) return bestMove;
    if (maxSpeed > 1) return this.getNextMoveGreedy(current, target, obstacles, maxSpeed / 2, obstacleRadius, numAngles);
    return [0, 0];
  }
  static distance(p1, p2) {
    return Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
  }
  static checkCollision(p1, p2, obstacles, radius) {
    for (const obs of obstacles) {
      const dist = this.distancePointToSegment(obs, p1, p2);
      if (dist < radius) return true;
    }
    return false;
  }
  static distancePointToSegment(p, v, w) {
    const l2 = (w[0] - v[0])**2 + (w[1] - v[1])**2;
    if (l2 === 0) return this.distance(p, v);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
    return this.distance(p, projection);
  }
}

console.log('=== DÉBUT DES TESTS DE NAVIGATION ===\n');

console.log('Test 1: Chemin dégagé vers la cible (0, 10)');
let move1 = SmartNavigation.getNextMoveGreedy([0, 0], [0, 10], [], 5, 2);
console.log(`Résultat attendu: direction [0, 5]`);
console.log(`Mouvement calculé: [${move1[0].toFixed(2)}, ${move1[1].toFixed(2)}]\n`);

console.log('Test 2: Un obstacle plein centre bloque la route (0, 5) avec un rayon de 3 !');
let move2 = SmartNavigation.getNextMoveGreedy([0, 0], [0, 10], [[0, 5]], 5, 3, 32);
console.log(`Résultat attendu: Le vaisseau devrait faire un pas en biais pour esquiver.`);
console.log(`Mouvement calculé: [${move2[0].toFixed(2)}, ${move2[1].toFixed(2)}]\n`);

console.log('Test 3: Cible proche (0, 4) bloquée par un mur en (0, 2)');
let move3 = SmartNavigation.getNextMoveGreedy([0, 0], [0, 4], [[0, 2]], 5, 1.5, 32);
console.log(`Résultat attendu: Esquive en diagonale au lieu d'y aller direct.`);
console.log(`Mouvement calculé: [${move3[0].toFixed(2)}, ${move3[1].toFixed(2)}]\n`);
