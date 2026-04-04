/**
 * ES-64: Implement animal.ts organism layer
 *
 * Base class for all animal organisms in the disease simulation.
 * Operates at the organism level — separate from the GPU agent layer.
 */

export class Animal {
  public species: string;
  public immunityLevel: number;
  public infected: boolean;
  public age: number;
  public alive: boolean;

  constructor(species: string, immunityLevel: number, infected: boolean, age: number, alive: boolean) {
    this.species = species;
    this.immunityLevel = immunityLevel;
    this.infected = infected;
    this.age = age;
    this.alive = alive;
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age >= 500) {
      this.alive = false;
    }
  }

  infect(pathogen: string): void {
    if (!this.alive) return;
    this.infected = true;
    this.immunityLevel = Math.max(0, this.immunityLevel - 0.1);
  }

  recover(): void {
    this.infected = false;
    this.immunityLevel = Math.min(1, this.immunityLevel + 0.1);
  }
}