export type Point2D = [number, number];

export class SmartNavigation {

  /**
   * Méthode de déplacement intelligente locale (Greedy / Échantillonnage)
   * Algorithme classiquement utilisé dans les jeux (Steering behaviors) car ultra-rapide et
   * "qui rapproche le plus de l'objectif en évitant les obstacles".
   * 
   * Pour le passer en 3D : 
   * Il suffirait de remplacer la boucle sur les angles par une distribution de points sur 
   * une sphère (angles phi et theta).
   *
   * @param current Position actuelle [x, y]
   * @param target Objectif à atteindre [x, y]
   * @param obstacles Liste des positions des obstacles [[x1, y1], [x2, y2], ...]
   * @param maxSpeed Distance maximale parcourable en un mouvement
   * @param obstacleRadius Distance minimale à garder par rapport au centre d'un obstacle
   * @param numAngles Nombre de directions à tester autour du vaisseau (ex: 16 ou 32)
   * @returns Un vecteur de mouvement [dx, dy] à appliquer
   */
  static getNextMoveGreedy(
    current: Point2D,
    target: Point2D,
    obstacles: Point2D[],
    maxSpeed: number,
    obstacleRadius: number = 5.0,
    numAngles: number = 32
  ): Point2D {
    // Si on est déjà très proche de la cible, on s'y rend directement
    const distToTarget = this.distance(current, target);
    if (distToTarget <= maxSpeed) {
      if (!this.checkCollision(current, target, obstacles, obstacleRadius)) {
        return [target[0] - current[0], target[1] - current[1]];
      }
    }

    let bestMove: Point2D = [0, 0];
    let minTargetDist = Infinity;
    let foundValidMove = false;

    // Échantillonnage de K directions autour du vaisseau
    for (let i = 0; i < numAngles; i++) {
      const angle = (i * 2 * Math.PI) / numAngles;
      
      // Mouvement potentiel (transposable en 3D avec des coordonnées sphériques)
      const dx = Math.cos(angle) * maxSpeed;
      const dy = Math.sin(angle) * maxSpeed;

      const proposedPos: Point2D = [current[0] + dx, current[1] + dy];

      // Vérifie si ce mouvement entraîne une collision avec les obstacles connus
      if (!this.checkCollision(current, proposedPos, obstacles, obstacleRadius)) {
        const dist = this.distance(proposedPos, target);
        if (dist < minTargetDist) {
          minTargetDist = dist;
          bestMove = [dx, dy];
          foundValidMove = true;
        }
      }
    }

    // Si on a trouvé un chemin dégagé qui approche, on y va
    if (foundValidMove) {
      return bestMove;
    }

    // --- Si tout est bloqué, on tente de faire un plus petit pas (ex: maxSpeed / 2) ---
    if (maxSpeed > 1) {
       return this.getNextMoveGreedy(current, target, obstacles, maxSpeed / 2, obstacleRadius, numAngles);
    }

    // Si on est vraiment coincé, on ne bouge pas (ou on peut retourner [0, 0] / amorcer un A* complet)
    return [0, 0];
  }

  /**
   * Algorithme A* complet sur une grille (Graph Search).
   * L'algorithme classique par excellence pour trouver un chemin global.
   * Transposable en 3D en rajoutant simplement une dimension Z à la recherche des voisins.
   */
  static getNextMoveAStar(
    current: Point2D,
    target: Point2D,
    obstacles: Point2D[],
    maxSpeed: number,
    gridResolution: number = 2.0,
    obstacleRadius: number = 5.0
  ): Point2D {
    // Structure locale pour les nœuds A*
    class Node {
      constructor(
        public pos: Point2D,
        public g: number,
        public h: number,
        public parent: Node | null = null
      ) {}
      get f() { return this.g + this.h; }
      get key() { return `${Math.round(this.pos[0] / gridResolution)},${Math.round(this.pos[1] / gridResolution)}`; }
    }

    const startNode = new Node(current, 0, this.distance(current, target));
    const openList: Map<string, Node> = new Map();
    const closedList: Set<string> = new Set();
    
    openList.set(startNode.key, startNode);

    let closestNode = startNode; // Pour fallback
    let maxIter = 1000;          // Limite de sécurité pour éviter le freeze de l'UI

    while (openList.size > 0 && maxIter-- > 0) {
      // Prend le nœud avec le F le plus faible
      let current_node!: Node;
      let minF = Infinity;
      for (const node of openList.values()) {
        if (node.f < minF) {
          minF = node.f;
          current_node = node;
        }
      }

      // Si on est assez proche de la cible (ou pile dessus)
      if (this.distance(current_node.pos, target) <= gridResolution * 1.5) {
        closestNode = current_node;
        break;
      }

      openList.delete(current_node.key);
      closedList.add(current_node.key);

      // On mémorise de toute façon le point le plus proche de la cible au cas où on abandonne (maxIter atteint)
      if (current_node.h < closestNode.h) {
        closestNode = current_node;
      }

      // Génération des 8 voisins (en 3D on génèrerait 26 voisins)
      const directions = [
        [1, 0], [0, 1], [-1, 0], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1]
      ];

      for (const [dx, dy] of directions) {
        const neighborPos: Point2D = [
          current_node.pos[0] + dx * gridResolution,
          current_node.pos[1] + dy * gridResolution
        ];

        const nodeKey = `${Math.round(neighborPos[0] / gridResolution)},${Math.round(neighborPos[1] / gridResolution)}`;

        if (closedList.has(nodeKey)) continue;

        // On vérifie si y aller percute un obstacle
        if (this.checkCollision(current_node.pos, neighborPos, obstacles, obstacleRadius)) {
          continue;
        }

        const g = current_node.g + this.distance(current_node.pos, neighborPos);
        const h = this.distance(neighborPos, target);
        const neighbor = new Node(neighborPos, g, h, current_node);

        if (!openList.has(nodeKey) || openList.get(nodeKey)!.g > g) {
          openList.set(nodeKey, neighbor);
        }
      }
    }

    // Remonte le chemin
    let pathNode = closestNode;
    const path: Point2D[] = [];
    while (pathNode.parent !== null) {
      path.push(pathNode.pos);
      pathNode = pathNode.parent;
    }
    path.reverse(); // Va du départ à la fin

    if (path.length === 0) return [0, 0];

    // On récupère le point du chemin atteignable avec notre `maxSpeed`
    // En gros on suit le résultat de A* "au bout" de notre maxSpeed
    let aimPoint = path[0];
    for (let i = 0; i < path.length; i++) {
        if (this.distance(current, path[i]) <= maxSpeed) {
            aimPoint = path[i];
        } else {
            break;
        }
    }

    const dx = aimPoint[0] - current[0];
    const dy = aimPoint[1] - current[1];
    return [dx, dy];
  }

  // === Fonctions utilitaires Math / Collisions ===

  static distance(p1: Point2D, p2: Point2D): number {
    return Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
  }

  /**
   * Vérifie avec une mathématique simple une collision entre un segment [p1, p2] et des obstacles sphériques
   */
  static checkCollision(p1: Point2D, p2: Point2D, obstacles: Point2D[], radius: number): boolean {
    for (const obs of obstacles) {
      // Distance la plus courte entre le point "obs" et le segment "p1-p2"
      const dist = this.distancePointToSegment(obs, p1, p2);
      if (dist < radius) {
        return true; // Collision !
      }
    }
    return false;
  }

  /**
   * Point -> Segment distance. Très générique et performant.
   */
  static distancePointToSegment(p: Point2D, v: Point2D, w: Point2D): number {
    const l2 = (w[0] - v[0])**2 + (w[1] - v[1])**2; // Longueur au carré
    if (l2 === 0) return this.distance(p, v);       // Segment = 1 point

    // Projection de `p` sur la ligne `v-w` avec un float "t"
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t)); // On fixe t entre 0 et 1 (restreint au segment)

    const projection: Point2D = [
      v[0] + t * (w[0] - v[0]),
      v[1] + t * (w[1] - v[1])
    ];

    return this.distance(p, projection);
  }

}
