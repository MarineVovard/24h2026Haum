import { SmartNavigation } from './smart-navigation';

describe('SmartNavigation', () => {
  
  it('doit avancer en ligne droite si aucun obstacle (Test 1)', () => {
    // maxSpeed = 5, cible à distance = 10 (Nord)
    const move = SmartNavigation.getNextMoveGreedy([0, 0], [0, 10], [], 5, 2);
    
    // On s'attend à un vecteur [0, 5] (ou très proche selon l'angle évalué)
    expect(Math.abs(move[0])).toBeLessThan(0.1); // dx proche de 0
    expect(Math.abs(move[1] - 5)).toBeLessThan(0.1); // dy proche de 5
  });

  it('doit esquiver si un obstacle bloque la route directe (Test 2)', () => {
    // maxSpeed = 5, cible à distance = 10 (Nord)
    // Obstacle pile au centre : [0, 5] avec un rayon de 3
    const move = SmartNavigation.getNextMoveGreedy([0, 0], [0, 10], [[0, 5]], 5, 3, 32);
    
    // Le vaisseau ne doit PAS aller en [0, 5] (ligne droite bloquée)
    // Il doit avoir un dx ou un dy significatif pour l'esquive
    expect(move[0]).not.toBeCloseTo(0, 1);
    expect(move[1]).not.toBeCloseTo(5, 1);
  });

  it('ne doit pas foncer dans un mur, même si la cible est atteignable en 1 coup (Test 3)', () => {
    // maxSpeed = 5, cible = [0, 4]
    // Mur/Vaisseau en [0, 2] avec rayon 1.5
    const move = SmartNavigation.getNextMoveGreedy([0, 0], [0, 4], [[0, 2]], 5, 1.5, 32);

    // L'algorithme ne va pas crasher en [0, 4] traversant l'obstacle
    // Il va dévier la trajectoire (dx différent de 0)
    expect(Math.abs(move[0])).toBeGreaterThan(0.5); 
  });

});
