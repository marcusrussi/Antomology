// @flow

const {
  add,
  equals,
  subtract,
  distance,
  makeVector,
  vectorTheta,
} = require('../utils/vectors');
const {config} = require('../config');
const {sin, cos, abs, sqrt} = Math;
const {gameReducer} = require('./gameReducer');
const {
  createIdleTask,
  createGoToLocationBehavior,
} = require('../state/tasks');
const {invariant} = require('../utils/errors');
const {
  randomIn,
  normalIn,
  oneOf,
  deleteFromArray,
} = require('../utils/helpers');
const {
  insertInGrid,
  deleteFromGrid,
  lookupInGrid,
  addEntity,
  removeEntity,
  moveEntity,
  changeEntityType,
  pickUpEntity,
  putDownEntity,
  maybeMoveEntity,
} = require('../utils/stateHelpers');
const {
  fastCollidesWith,
  fastGetEmptyNeighborPositions,
  fastGetNeighbors,
  collides,
  getEntitiesByType,
  filterEntitiesByType,
  insideWorld,
  getEntitiesInRadius,
} = require('../selectors/selectors');
const {makeEgg} = require('../entities/egg');
const {makeLarva} = require('../entities/larva');
const {makePupa} = require('../entities/pupa');
const {makeAnt} = require('../entities/ant');

import type {
  GameState, Entity, Action, Ant, Behavior, Condition, Task, AntAction, AntActionType
} from '../types';

const tickReducer = (game: GameState, action: Action): GameState => {
  switch (action.type) {
    case 'START_TICK':
      if (game != null && game.tickInterval != null) {
        return game;
      }
      return {
        ...game,
        tickInterval: setInterval(
          // HACK: store is only available via window
          () => store.dispatch({type: 'TICK'}),
          config.msPerTick,
        ),
      };
    case 'STOP_TICK':
      clearInterval(game.tickInterval);
      game.tickInterval = null;
      return game;
    case 'TICK':
      return handleTick(game);
  }
  return game;
};

let totalTime = 0;

const handleTick = (game: GameState): GameState => {
  // const startTime = performance.now();

  // get held entities
  const heldEntityIDs = [];
  for (const id of game.ANT) {
    const ant = game.entities[id];
    if (!ant.alive) {
      continue;
    }

    if (ant.holding != null && !heldEntityIDs.includes(ant.holding.id)) {
      heldEntityIDs.push(ant.holding.id);
    }
  }

  // update held big entities
  const heldBigEntities = heldEntityIDs
    .map(i => game.entities[i])
    .filter(e => e.toLift > 1);
  for (const bigEntity of heldBigEntities) {
    if (bigEntity.toLift <= bigEntity.heldBy.length) {
      const targetLoc = {
        position: {
          x: Math.round(bigEntity.position.x + bigEntity.width / 2),
          y: bigEntity.lifted ? bigEntity.position.y - 1 : bigEntity.position.y,
        },
        width: 1,
        height: 1,
      };
      if (!bigEntity.lifted) {
        const didMove = maybeMoveEntity(
          game, bigEntity,
          add(bigEntity.position, {x: 0, y: 1}),
          true,
        );
        const allDone = bigEntity.heldBy
          .map(i => game.entities[i])
          .filter(a => a.task.name === 'Holding and Idle')
          .length === bigEntity.heldBy.length;
        bigEntity.lifted = didMove;
        if (didMove) {
          for (let i = 0; i < bigEntity.heldBy.length; i++) {
            const ant = game.entities[bigEntity.heldBy[i]];
            // if (
            //   ant.task.name === 'Picking up ' + bigEntity.type ||
            //   ant.task.name === 'Holding and Idle'
            // ) {
            //   break; // we already did this
            // }
            ant.leadHolder = i === 0;
            ant.taskStack = [];
            ant.taskIndex = 0;
            const goToLocationBehavior = createGoToLocationBehavior(targetLoc);
            ant.task = {
              name: 'Picking up ' + bigEntity.type,
              repeating: false,
              behaviorQueue: [
                goToLocationBehavior,
                {
                  type: 'SWITCH_TASK',
                  task: 'Holding and Idle'
                }
              ],
            };
          }
        }
      }
    }
  }

  // update ants
  for (const id of game.ANT) {
    const ant = game.entities[id];
    if (!ant.alive) {
      continue;
    }
    ant.age += 1;
    performTask(game, ant);

    ant.calories -=1;
    // ant starvation
    if (ant.calories <= 0) {
      ant.alive = false;
      if (ant.holding) {
        putDownEntity(game, ant);
      }
    }
  }

  updateAntLifeCycles(game);

  // update pheromones
  for (const id of game.PHEROMONE) {
    const pheromone = game.entities[id];
    const antsHere = lookupInGrid(game.grid, pheromone.position)
      .map(i => game.entities[i])
      .filter(e => e.type === 'ANT')
      .length > 0;
    if (antsHere) {
      pheromone.quantity = Math.min(
        pheromone.quantity + 1, config.pheromoneMaxQuantity,
      );
    } else {
      pheromone.quantity -= 1;
    }
    if (pheromone.quantity <= 0) {
      removeEntity(game, pheromone);
    }
  }

  // compute gravity
  for (const entityType of config.fallingEntities) {
    for (const id of game[entityType]) {
      const entity = game.entities[id];
      if (!entity.position) continue;
      // TODO lifted (big)entities not affected by gravity for now
      const isBig = entity.toLift > 1;
      const isReadyToLift = entity.toLift <= entity.heldBy.length;
      if (entity.lifted) continue;
      // if (isBig && isReadyToLift && !entity.isLifted) continue;
      const positionBeneath = subtract(entity.position, {x: 0, y: 1});
      const entitiesBeneath = fastCollidesWith(game, {...entity, position: positionBeneath})
        .filter(e => config.stopFallingEntities.includes(e.type))
        .length > 0;
      let entitiesSupporting = [];
      if (config.supportedEntities.includes(entityType)) {
        entitiesSupporting = fastCollidesWith(game, entity)
          .filter(e => config.supportingBackgroundTypes.includes(e.subType))
        if (config.climbingEntities.includes(entity.type)) {
          entitiesSupporting = entitiesSupporting
            .concat(
              fastGetNeighbors(game, entity, true /* diagonal */)
              .filter(e => config.stopFallingEntities.includes(e.type))
            );
        }
      }
      if (
        (!entitiesSupporting.length > 0 && !entitiesBeneath)
        && insideWorld(game, positionBeneath)
      ) {
          moveEntity(game, entity, positionBeneath);
      }
    }
  }

  // update FoW vision
  const previouslyVisible = [];
  for (const entityType of config.entitiesInFog) {
    for (const id of game[entityType]) {
      const entity = game.entities[id];
      if (entity.position == null) {
        entity.visible = true; // held entities are visible
        continue;
      }
      if (entity.visible) {
        previouslyVisible.push(entity);
        entity.visible = false;
      }
    }
  }
  for (const id of game.ANT) {
    const ant = game.entities[id];
    getEntitiesInRadius(game, ant.position, config.antVisionRadius)
      .forEach(e => e.visible = true);
  }
  for (const entity of previouslyVisible) {
    if (!entity.visible) {
      entity.lastSeenPos = entity.position;
    }
  }

  game.time += 1;

  // const time = performance.now() - startTime;
  // totalTime += time;
  // if (game.time % 10 === 0) {
  //   console.log(time.toFixed(3), 'avg', (totalTime / game.time).toFixed(3));
  // }

  return game;
}

const updateAntLifeCycles = (game): void => {
  // update eggs
  for (const id of game.EGG) {
    const egg = game.entities[id];
    egg.age += 1;
    if (egg.age > config.eggHatchAge) {
      game.entities[id] = {...makeLarva(egg.position, egg.subType), id};
      changeEntityType(game, game.entities[id], 'EGG', 'LARVA');
    }
  }

  // update larva
  for (const id of game.LARVA) {
    const larva = game.entities[id];
    larva.age += 1;
    if (!larva.alive) {
      continue;
    }

    larva.calories -= 1;
    // larva starvation
    if (larva.calories <= 0) {
      larva.alive = false;
      continue;
    }

    if (larva.calories >= config.larvaEndCalories) {
      game.entities[id] = {...makePupa(larva.position, larva.subType), id};
      changeEntityType(game, game.entities[id], 'LARVA', 'PUPA');
    }
  }

  // update pupa
  for (const id of game.PUPA) {
    const pupa = game.entities[id];
    pupa.age += 1;
    if (pupa.age > config.pupaHatchAge) {
      game.entities[id] = {...makeAnt(pupa.position, pupa.subType), id};
      changeEntityType(game, game.entities[id], 'PUPA', 'ANT');
    }
  }
}

// Update the world based on the ant (attempting) performing its task.
// In place.
const performTask = (game: GameState, ant: Ant): void => {
  if (ant.task == null) {
    return;
  }
  const {task, taskIndex} = ant;
  // if run off the end of the behavior queue, then repeat or pop back to parent
  if (taskIndex >= task.behaviorQueue.length) {
    if (task.repeating) {
      ant.taskIndex = 0;
    } else {
      const parentTask = ant.taskStack.pop();
      if (parentTask == null) {
        ant.taskIndex = 0;
        ant.task = createIdleTask();
      } else {
        ant.taskIndex = 0; // TODO there was starting taskIndex and parent
        // task's index, but this involves mutating the task which we can't do
        ant.task = game.tasks.filter(t => t.name === parentTask.name)[0];
      }
    }
    return;
  }
  const behavior = task.behaviorQueue[taskIndex];
  const done = performBehavior(game, ant, behavior);

  // if the behavior is done, advance the task index
  if (done) {
    ant.taskIndex += 1;
    if (task.repeating) {
      ant.taskIndex = ant.taskIndex % task.behaviorQueue.length;
    }
  // HACK to deal with switching tasks in a nested behavior
  } else if (ant.taskIndex == -1) {
    ant.taskIndex = 0;
  }
};

// behaviors can be recursive, so use this
const performBehavior = (game: GameState, ant: Ant, behavior: Behavior): boolean => {
  let done = false
  switch (behavior.type) {
    case 'DO_ACTION': {
      performAction(game, ant, behavior.action);
      done = true;
      break;
    }
    case 'IF': {
      const childBehavior = behavior.behavior;
      if (evaluateCondition(game, ant, behavior.condition)) {
        performBehavior(game, ant, childBehavior);
      } else if (behavior.elseBehavior != null) {
        performBehavior(game, ant, behavior.elseBehavior);
      }
      // TODO support nested execution
      // if (childBehavior.done) {
      done = true;
      // }
      break;
    }
    case 'WHILE': {
      const childBehavior = behavior.behavior;
      if (evaluateCondition(game, ant, behavior.condition)) {
        performBehavior(game, ant, childBehavior);
      } else {
        done = true;
      }
      break;
    }
    case 'SWITCH_TASK': {
      const parentTask = ant.task;
      ant.task = game.tasks.filter(t => t.name === behavior.task)[0];
      ant.taskStack.push({
        name: parentTask.name,
        index: ant.taskIndex,
      });
      // HACK: this sucks. done doesn't always propagate up particularly if
      // you switch tasks from inside a do-while
      ant.taskIndex = -1; // it's about to +1 in performTask
      done = true;
      break;
    }
  }
  return done;
};

const evaluateCondition = (
  game: GameState, ant: Ant, condition: Condition,
): boolean => {
  let isTrue = false;
  const {not, comparator, payload} = condition;
  const {object} = payload;
  switch (condition.type) {
    case 'LOCATION': {
      // comparator must be EQUALS
      // ant is considered to be at a location if it is within its boundingRect
      let loc = object;
      if (typeof loc === 'string') {
        loc = getEntitiesByType(game, ['LOCATION']).filter(l => l.name === loc)[0];
      }
      isTrue = collides(ant, loc);
      break;
    }
    case 'HOLDING': {
      if (object === 'ANYTHING' && (ant.holding != null && ant.holding.type != null)) {
        isTrue = true;
      } else if (object === 'NOTHING' && (ant.holding == null || ant.holding.type == null)) {
        isTrue = true;
      } else if (
        object === 'DIRT' || object === 'FOOD' ||
        object === 'EGG' || object === 'LARVA' ||
        object === 'PUPA' || object === 'DEAD_ANT'
      ) {
        isTrue = ant.holding != null && ant.holding.type == object;
      } else {
        isTrue = (ant.holding == null && object == null) ||
          ant.holding.type == object; // object is the held type
      }
      break;
    }
    case 'NEIGHBORING': {
      // comparator must be EQUALS
      const neighbors = fastGetNeighbors(game, ant);
      if (object === 'ANYTHING') {
        isTrue = neighbors.length > 0;
      } else if (object === 'NOTHING') {
        isTrue = neighbors.length === 0;
      } else if (object === 'MARKED_DIRT') {
        let pheromoneNeighbors = neighbors
          .filter(e => e.type === 'PHEROMONE');
        let dirtNeighbors = neighbors
          .filter(e => e.type === 'DIRT');
        isTrue = false;
        for (const dirt of dirtNeighbors) {
          for (const pheromone of pheromoneNeighbors) {
            if (equals(dirt.position, pheromone.position)) {
              isTrue = true;
            }
          }
        }
      } else if (
        object === 'DIRT' || object === 'FOOD' ||
        object === 'EGG' || object === 'LARVA' ||
        object === 'PUPA' || object === 'DEAD_ANT' ||
        object === 'TRAIL'
      ) {
        let typeName = object;
        if (object === 'TRAIL') {
          typeName = 'PHEROMONE';
        }
        isTrue = neighbors.filter(n => n.type === typeName).length > 0;
      } else if (object != null && object.id != null) {
        isTrue = neighbors.filter(n => n.id === object.id).length > 0;
      } else if (typeof object === 'string') {
        isTrue = neighbors.filter(l => l.name === object).length > 0;
      }
      break;
    }
    case 'BLOCKED': {
      // comparator must be EQUALS
      isTrue = ant.blocked;
      break;
    }
    case 'RANDOM': {
      const value = object;
      const rand = Math.random();
      if (comparator === 'EQUALS') {
        isTrue = rand == value;
      } else if (comparator === 'LESS_THAN') {
        isTrue = rand < value;
      } else if (comparator === 'GREATER_THAN') {
        isTrue = rand > value;
      }
      break;
    }
    case 'CALORIES': {
      const value = object;
      const antCalories = ant.calories;
      if (comparator === 'EQUALS') {
        isTrue = antCalories == value;
      } else if (comparator === 'LESS_THAN') {
        isTrue = antCalories < value;
      } else if (comparator === 'GREATER_THAN') {
        isTrue = antCalories > value;
      }
      break;
    }
    case 'AGE': {
      // TODO: age, calories, random are very similar
      const value = object;
      const antAge = ant.age;
      if (comparator === 'EQUALS') {
        isTrue = antAge == value;
      } else if (comparator === 'LESS_THAN') {
        isTrue = antAge < value;
      } else if (comparator === 'GREATER_THAN') {
        isTrue = antAge > value;
      }
      break;
    }
  }

  return not ? !isTrue : isTrue;
};

const performAction = (
  game: GameState, ant: Ant, action: AntAction,
): void => {
  const {payload} = action;
  let {object} = payload;
  let actionType = action.type;

  // first handle ants that are holding a big entity
  if (ant.holding != null && ant.holding.toLift > 1) {
    const bigEntity = ant.holding;

    if (bigEntity.toLift > bigEntity.heldBy.length) {
      // if the ant is assigned something else to do, drop it
      if (action.type !== 'PUTDOWN' && action.type !== 'IDLE') {
        putDownEntity(game, ant);
      }
    }
  }

  // then handle the actually-assigned action
  switch (actionType) {
    case 'IDLE': {
      // unstack, similar to moving out of the way of placed dirt
      const stackedAnts = fastCollidesWith(game, ant)
        .filter(e => config.antBlockingEntities.includes(e.type) || e.type == 'ANT');
      if (stackedAnts.length > 0) {
        const freePositions = fastGetEmptyNeighborPositions(
          game, ant, config.antBlockingEntities,
        );
        if (freePositions.length > 0) {
          moveEntity(game, ant, oneOf(freePositions));
        }
      } else {
        if (Math.random() < 0.05) {
          const factor = Math.random() < 0.5 ? 1 : -1;
          ant.theta += factor * Math.PI/2;
        } else {
          ant.calories += 1; // calories don't go down if you fully idle
        }
      }
      break;
    }
    case 'MOVE': {
      let loc = object;
      let obj = object;
      if (obj === 'TRAIL') {
        const pheromone = lookupInGrid(game.grid, ant.position)
          .map(id => game.entities[id])
          .filter(e => e.type === 'PHEROMONE')[0];
        if (pheromone != null) {
          loc = {position: add(ant.position, makeVector(pheromone.theta, 1))};
        } else {
          obj = 'RANDOM';
        }
      }
      if (obj === 'RANDOM') {
        // randomly select loc based on free neighbors
        let freePositions = fastGetEmptyNeighborPositions(
          game, ant, config.antBlockingEntities
        ).filter((pos) => insideWorld(game, pos));
        if (freePositions.length == 0) {
          break; // can't move
        }
        // don't select previous position
        freePositions = freePositions.filter(pos => {
          return pos.x != ant.prevPosition.x || pos.y != ant.prevPosition.y;
        });
        if (freePositions.length == 0) {
          // then previous position was removed, so fall back to it
          loc = {position: ant.prevPosition};
        } else {
          // don't cross colonyEntrance boundary
          const colEnt = game.entities[config.colonyEntrance].position;
          freePositions = freePositions.filter(pos => !equals(pos, colEnt));
          if (freePositions.length == 0) {
            // fall back to previous position
            loc = {position: ant.prevPosition};
          }
          loc = {position: oneOf(freePositions)};
        }
      } else if (obj != 'TRAIL' && typeof obj === 'string') {
        loc = getEntitiesByType(game, ['LOCATION']).filter(l => l.name === obj)[0];
      }
      const distVec = subtract(loc.position, ant.position);
      if (distVec.x == 0 && distVec.y == 0) {
        break; // you're there
      }
      let moveVec = {x: 0, y: 0};
      let moveAxis = 'y';
      // different policies for choosing move direction
      // if (Math.abs(distVec.x) > Math.abs(distVec.y)) {
      if (distVec.y == 0 ||(distVec.x !== 0 && Math.random() < 0.5)) {
        moveAxis = 'x';
      }
      moveVec[moveAxis] += distVec[moveAxis] > 0 ? 1 : -1;
      let nextPos = add(moveVec, ant.position);
      let didMove = maybeMoveEntity(game, ant, nextPos);
      if (didMove) {
        ant.blocked = false;
        ant.blockedBy = null;
      } else { // else try moving along the other axis
        moveVec[moveAxis] = 0;
        moveAxis = moveAxis === 'y' ? 'x' : 'y';
        if (distVec[moveAxis] > 0) {
          moveVec[moveAxis] += 1;
        } else if (distVec[moveAxis] < 0) {
          moveVec[moveAxis] -= 1;
        } else {
          // already axis-aligned with destination, but blocked
          // TODO block is broken now
          ant.blocked = true;
          // ant.blockedBy = occupied[0];
          break;
        }
        nextPos = add(moveVec, ant.position);
        didMove = maybeMoveEntity(game, ant, nextPos);
        if (didMove) {
          ant.blocked = false;
          ant.blockedBy = null;
        } else { // TODO block is broken now
        // } else if (occpied.length > 0) {
          ant.blocked = true;
          // ant.blockedBy = occupied[0];
        }
      }
      break;
    }
    case 'PICKUP': {
      let entityToPickup = object;
      if (entityToPickup === 'BLOCKER') {
        entityToPickup = ant.blockedBy;
      } else if (entityToPickup === 'MARKED_DIRT') {
        const neighbors = fastGetNeighbors(game, ant);
        let pheromoneNeighbors = neighbors
          .filter(e => e.type === 'PHEROMONE');
        let dirtNeighbors = neighbors
          .filter(e => e.type === 'DIRT');
        const markedDirt = [];
        for (const dirt of dirtNeighbors) {
          for (const pheromone of pheromoneNeighbors) {
            if (equals(dirt.position, pheromone.position)) {
              markedDirt.push(dirt);
            }
          }
        }
        entityToPickup = oneOf(markedDirt);
      } else if (
        entityToPickup === 'DIRT' || entityToPickup === 'FOOD' ||
        entityToPickup === 'EGG' || entityToPickup === 'LARVA' ||
        entityToPickup === 'PUPA' || entityToPickup === 'DEAD_ANT'
      ) {
        entityToPickup = oneOf(
          fastGetNeighbors(game, ant).filter(e => e.type == entityToPickup)
        );
      } else if (entityToPickup != null && entityToPickup.position != null ) {
        entityToPickup = fastGetNeighbors(game, ant)
          .filter(e => e.id === entityToPickup.id)[0];
      }
      if (entityToPickup == null || entityToPickup.position == null) {
        break;
      }
      if (ant.holding == null) {
        pickUpEntity(game, ant, entityToPickup);
      }
      break;
    }
    case 'PUTDOWN': {
      let locationToPutdown = object;
      if (locationToPutdown == null) {
        locationToPutdown = {position: ant.position, width: 1, height: 1};
      }
      const putDownFree = fastCollidesWith(game, locationToPutdown)
        .filter(e => config.antBlockingEntities.includes(e.type))
        .length === 0;
      if (collides(ant, locationToPutdown) && ant.holding != null && putDownFree) {
        putDownEntity(game, ant);
        // move the ant out of the way
        const freePositions = fastGetEmptyNeighborPositions(
          game, ant, config.antBlockingEntities,
        );
        if (freePositions.length > 0) {
          moveEntity(game, ant, freePositions[0]);
        }
      }
      break;
    }
    case 'EAT': {
      let entityToEat = object;
      const neighborFood = fastGetNeighbors(game, ant)
        .filter(e => e.type === 'FOOD');
      if (entityToEat == null) {
        entityToEat = oneOf(neighborFood);
      } else if (entityToEat.id != null) {
        entityToEat = neighborFood.filter(f => f.id == entityToEat.id)[0];
      }
      if (entityToEat == null) break;

      const caloriesEaten = Math.min(
        config.antCaloriesPerEat,
        entityToEat.calories,
        config.antMaxCalories - ant.calories,
      );
      ant.calories += caloriesEaten;
      entityToEat.calories -= caloriesEaten;
      // remove the food item if it has no more calories
      if (entityToEat.calories <= 0) {
        removeEntity(game, entityToEat);
      }
      break;
    }
    case 'FEED': {
      const feedableEntities = fastGetNeighbors(game, ant)
        .filter(e => ['ANT', 'LARVA'].includes(e.type));
      if (
        ant.holding != null && ant.holding.type === 'FOOD' &&
        feedableEntities.length > 0
      ) {
        // prefer to feed larva if possible
        let fedEntity = oneOf(feedableEntities);
        for (const e of feedableEntities) {
          if (e.type === 'LARVA') {
            fedEntity = e;
            break;
          }
        }
        fedEntity.calories += ant.holding.calories;
        removeEntity(game, ant.holding);
        ant.holding = null;
      }
      break;
    }
    case 'MARK': {
      // TODO
      break;
    }
    case 'LAY': {
      if (ant.subType != 'QUEEN') {
        break; // only queen lays eggs
      }
      const nothingInTheWay = fastCollidesWith(game, ant)
        .filter(e => config.antBlockingEntities.includes(e.type))
        .length === 0;
      const dirtBelow = lookupInGrid(game.grid, add(ant.position, {x: 0, y: -1}))
        .filter(id => game.entities[id].type === 'DIRT')
        .length > 0;
      if (nothingInTheWay && dirtBelow) {
        const egg = makeEgg(ant.position, 'WORKER'); // TODO
        addEntity(game, egg);
        // move the ant out of the way
        const freePositions = fastGetEmptyNeighborPositions(
          game, ant, config.antBlockingEntities,
        );
        if (freePositions.length > 0) {
          moveEntity(game, ant, freePositions[0]);
        }
      }
      break;
    }
    case 'COMMUNICATE': {
      // TODO
      break;
    }
  }

};

module.exports = {tickReducer};
