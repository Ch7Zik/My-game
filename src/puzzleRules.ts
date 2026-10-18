import { isNear, type Point } from './geometry.ts';

export function canDrag(isPlaced: boolean): boolean { return !isPlaced; }
export function wasDragged(start: Point, end: Point, minimumDistance = 8): boolean { return !isNear(start, end, minimumDistance); }
export function shouldSnap(position: Point, target: Point, radius: number): boolean { return isNear(position, target, radius); }
export function isComplete(placed: boolean[]): boolean { return placed.length > 0 && placed.every(Boolean); }
export function canAdvance(complete: boolean, nextButtonPressed: boolean): boolean { return complete && nextButtonPressed; }
