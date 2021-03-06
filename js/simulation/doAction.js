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

const doAction = (
  game: GameState, ant: Ant, action: AntAction,
): void => {
  const {payload} = action;
  let {object, constraint} = payload;
  let actionType = action.type;

  // first handle ants that are holding a big entity
  if (ant.holding != null && ant.holding.toLift > 1) {
    const bigEntity = ant.holding;

    // if (bigEntity.toLift > bigEntity.heldBy.length) {
    //   // if the ant is assigned something else to do, drop it
    //   if (action.type !== 'PUTDOWN' && action.type !== 'IDLE') {
    //     putDownEntity(game, ant);
    //   }
    // }
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
      ant.prevPosition = {...ant.position};
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
        // don't cross colonyEntrance boundary
        // const colEnt = game.entities[config.colonyEntrance].position;
        // freePositions = freePositions.filter(pos => !equals(pos, colEnt));
        if (freePositions.length == 0) {
          // fall back to previous position
          loc = {position: ant.prevPosition};
        }
        // if required, stay inside location boundary
        if (constraint != null) {
          freePositions = freePositions.filter(pos => {
            const inGrid = lookupInGrid(game.grid, pos);
            return inGrid.includes(constraint);
          });
        }
        loc = {position: oneOf(freePositions)};
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
        if (entityToPickup.toLift > 1) {
          const bigEntity = entityToPickup;
          const targetLoc = {
            position: {
              x: Math.round(bigEntity.position.x + bigEntity.width / 2),
              y: bigEntity.lifted ? bigEntity.position.y - 1 : bigEntity.position.y,
            },
            width: 1,
            height: 1,
          };
          ant.taskStack = [];
          ant.taskIndex = -1; // HACK to switch tasks inside a task
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

const doHighLevelAction = (
  game: GameState, ant: Ant, action: AntAction,
): void => {
  const {payload} = action;
  let {object} = payload;
  let actionType = action.type;

  switch (actionType) {
    // high level move is a random move inside a location
    case 'MOVE': {
      doAction(
        game, ant,
        {
          type: 'MOVE',
          payload: {object: 'RANDOM', constraint: action.payload.object}
        },
      );
      break;
    }
  }
};

module.exports = {doAction, doHighLevelAction};
