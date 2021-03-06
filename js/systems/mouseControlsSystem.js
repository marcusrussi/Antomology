
const {config} = require('../config');
const {
  getSelectedAntIDs,
  fastCollidesWith,
  getEntitiesByType,
  entitiesInMarquee,
} = require('../selectors/selectors');
const {canvasToGrid, gridToCanvas} = require('../utils/canvasHelpers');
const {
  add, subtract, equals, makeVector, vectorTheta, multiply, floor,
} = require('../utils/vectors');
const {makeLocation} = require('../entities/location');
const {makePheromone} = require('../entities/pheromone');
const {lookupInGrid} = require('../utils/stateHelpers');
const {
  createGoToLocationTask,
  createDoAction,
} = require('../state/tasks');

const initMouseControlsSystem = (store) => {
  const {dispatch} = store;

  let canvas = null;
  document.onmouseup = (ev) => {
    const state = store.getState();
    if (state.game == null) return;
      const gridPos = getClickedPos(state.game, ev);

    if (ev.button == 0) { // left click
      dispatch({type: 'SET_MOUSE_DOWN', isLeft: true, isDown: false});
      dispatch({type: 'SET_VIEW_POS', viewPos: floor(state.game.viewPos)});
      if (gridPos == null) return;
      handleLeftClick(state, dispatch, gridPos);
    } else if (ev.button == 2) { // right click
      dispatch({type: 'SET_MOUSE_DOWN', isLeft: false, isDown: false});
      if (gridPos == null) return;
      handleRightClick(state, dispatch, gridPos);
    }
  }

  document.onmousedown = (ev) => {
    const state = store.getState();
    if (state.game == null) return;
    const gridPos = getClickedPos(state.game, ev);
    if (gridPos == null) return;
    const {game} = state;

    if (ev.button == 0) { // left click
      dispatch(
        {type: 'SET_MOUSE_DOWN', isLeft: true, isDown: true, downPos: gridPos}
      );
      if (game.userMode == 'MARK_TRAIL') {
        const clickedEntities = lookupInGrid(game.grid, gridPos)
          .map(i => game.entities[i]);
        const clickedLocations = clickedEntities
          .filter(e => e.type === 'LOCATION');
        const clickedPheromones = clickedEntities
          .filter(e => e.type === 'PHEROMONE');

        if (clickedLocations.length > 0) {
          // TODO distinguish which location you're starting from/ending on
          const loc = clickedLocations[0];
          if (game.curEdge == null) {
            dispatch({type: 'CREATE_EDGE', start: loc.id});
          } else {
            console.log("does update edge inside mouse down ever happen??");
            const edge = game.edges[game.curEdge];
            dispatch({
              type: 'UPDATE_EDGE', id: edge.id, edge: {...edge, end: loc.id}
            });
          }
          dispatch({
            type: 'CREATE_ENTITY',
            entity: makePheromone(gridPos, 0, 1, store.getState().game.curEdge),
          });
        } else if (clickedPheromones.length > 0) {
          const edge = game.edges[clickedPheromones[0].edge];
          if (!edge.end) {
            dispatch({type: 'SET_CUR_EDGE', curEdge: edge.id});
          }
          dispatch({
            type: 'CREATE_ENTITY',
            entity: makePheromone(gridPos, 0, 1, store.getState().game.curEdge),
          });
        }
      }
    } else if (ev.button == 2) { // right click
      dispatch(
        {type: 'SET_MOUSE_DOWN', isLeft: false, isDown: true, downPos: gridPos},
      );
    }
  }

  document.onmousemove = (ev) => {
    const state = store.getState();
    if (state.game == null) return;
    const gridPos = getClickedPos(state.game, ev);
    const canvasPos = getMousePixel(ev);
    if (gridPos == null) return;
    handleMouseMove(state, dispatch, gridPos, canvasPos);
  }

  document.onwheel = (ev) => {
    const state = store.getState();
    if (state.game == null) return;
    const gridPos = getClickedPos(state.game, ev);
    if (gridPos == null) return;
    store.dispatch({type: 'ZOOM', out: ev.wheelDelta < 0 ? 1 : -1});
  }

};

////////////////////////////////////////////////////////////////////////////
// Mouse move
////////////////////////////////////////////////////////////////////////////

const handleMouseMove = (
  state: State,
  dispatch: Dispatch,
  gridPos: Vector,
  canvasPos: Vector,
): void => {
  if (state.game.mouse.isLeftDown && state.game.userMode === 'MARK_TRAIL') {
    dispatch({type: 'SET_MOUSE_POS', curPos: gridPos, curPixel: canvasPos});
    if (state.game.curEdge == null) {
      return; // not creating an edge
    }
    let prevPheromone = state.game.entities[state.game.prevPheromone];
    if (prevPheromone == null) {
      dispatch({
        type: 'CREATE_ENTITY',
        entity: makePheromone(gridPos, 0 /* theta */, 1, state.game.curEdge),
      });
      return;
    }
    if (equals(gridPos, prevPheromone.position)) {
      return; // don't make another at its current spot
    }

    let prevPos = null;
    let prevPheromoneID = null;
    let cursor = {...prevPheromone.position};
    while (!equals(cursor, gridPos)) {
      const diff = subtract(gridPos, cursor);
      // initial case
      if (prevPos == null) {
        prevPos = {...cursor};
        prevPheromoneID = prevPheromone.id;
      }
      if (Math.abs(diff.x) > Math.abs(diff.y)) {
        cursor.x += diff.x / Math.abs(diff.x);
      } else {
        cursor.y += diff.y / Math.abs(diff.y);
      }
      const theta = vectorTheta(subtract(cursor, prevPos));
      const curPheromone = makePheromone({...cursor}, theta, 1, state.game.curEdge);
      dispatch({
        type: 'CREATE_ENTITY',
        entity: curPheromone,
      });
      dispatch({type: 'UPDATE_THETA', id: prevPheromoneID, theta});

      prevPheromoneID = curPheromone.id;
      prevPos = {...cursor};
    }
  } else if (state.game.mouse.isLeftDown && state.game.userMode === 'PAN') {
    const dragDiffPixel = subtract(canvasPos, state.game.mouse.curPixel);
    if (equals(dragDiffPixel, {x: 0, y: 0})) {
      dispatch({type: 'SET_MOUSE_POS', curPos: gridPos, curPixel: canvasPos});
      return;
    }
    const dragDiff = multiply(dragDiffPixel,{
      x: config.width / config.canvasWidth,
      y: -1 * config.height / config.canvasHeight,
    });
    const nextViewPos = subtract(state.game.viewPos, dragDiff);
    if (
      nextViewPos.x < 0 || nextViewPos.y < 0 ||
      nextViewPos.x + config.width > state.game.worldWidth ||
      nextViewPos.y + config.height > state.game.worldHeight
    ) {
      dispatch({type: 'SET_MOUSE_POS', curPos: gridPos, curPixel: canvasPos});
      return;
    }
    dispatch({type: 'SET_MOUSE_POS', curPos: gridPos, curPixel: canvasPos});
    dispatch({type: 'SET_VIEW_POS', viewPos: nextViewPos});
  } else {
    dispatch({type: 'SET_MOUSE_POS', curPos: gridPos, curPixel: canvasPos});
  }
}
////////////////////////////////////////////////////////////////////////////
// Left click
////////////////////////////////////////////////////////////////////////////

const handleLeftClick = (
  state: State,
  dispatch: Dispatch,
  gridPos: Vector,
): void => {
  const {game} = state;
  // handle creating locations
  if (game.userMode === 'CREATE_LOCATION') {
    const dimensions = subtract(gridPos, game.mouse.downPos);
    const locPosition = {...game.mouse.downPos};
    if (dimensions.x < 0) {
      locPosition.x = locPosition.x + dimensions.x;
    }
    if (dimensions.y < 0) {
      locPosition.y = locPosition.y + dimensions.y;
    }
    const newLocation = makeLocation(
      game.nextLocationName,
      Math.abs(dimensions.x) + 1, // off by one
      Math.abs(dimensions.y) + 1,
      locPosition,
    );
    dispatch({type: 'CREATE_ENTITY', entity: newLocation});
    return;
  } else if (game.userMode === 'SELECT') {
    // handle selecting ants
    const {mouse} = game;
    const dims = subtract(mouse.curPos, mouse.downPos);
    const x = dims.x > 0 ? mouse.downPos.x : mouse.curPos.x;
    const y = dims.y > 0 ? mouse.downPos.y : mouse.curPos.y;
    const marqueeLocation =
      {position: {x, y}, width: Math.abs(dims.x) + 1, height: Math.abs(dims.y) + 1};
    let clickedEntities = entitiesInMarquee(game, marqueeLocation)
      .filter(e => config.selectableEntities.includes(e.type))
    // const obeliskID = game.OBELISK[0];
    // if (clickedEntities.includes(obeliskID)) {
    //   clickedEntities = [obeliskID];
    // }
    const pheromonesInEdges = [];
    for (const entity of clickedEntities) {
      if (entity.type === 'PHEROMONE') {
        const edge = game.edges[entity.edge];
        pheromonesInEdges.push(...edge.pheromones);
      }
    }
    if (clickedEntities.length > 0) {
      const clickedIDs = clickedEntities.map(e => e.id);
      for (const ph of pheromonesInEdges) {
        if (!clickedIDs.includes(ph)) {
          clickedIDs.push(ph);
        }
      }
      dispatch({
        type: 'SET_SELECTED_ENTITIES',
        entityIDs: clickedIDs.slice(0, config.maxSelectableAnts),
      });
    } else if (game.selectedEntities.length > 0) {
      dispatch({
        type: 'SET_SELECTED_ENTITIES',
        entityIDs: [],
      });
    }
  } else if (game.userMode === 'MARK_TRAIL') {
    dispatch({type: 'SET_PREV_PHEROMONE', id: null});
    const clickedEntities = lookupInGrid(game.grid, gridPos)
      .map(i => game.entities[i]);
    const clickedLocations = clickedEntities
      .filter(e => e.type === 'LOCATION');

    if (clickedLocations.length > 0 && game.curEdge != null) {
      // TODO distinguish which location you're starting from/ending on
      const loc = clickedLocations[0];
      const edge = game.edges[game.curEdge];
      dispatch({
        type: 'UPDATE_EDGE', id: edge.id, edge: {...edge, end: loc.id}
      });
    } else {
      dispatch({type: 'SET_CUR_EDGE', curEdge: null});
    }
  }
};

////////////////////////////////////////////////////////////////////////////
// Right click
////////////////////////////////////////////////////////////////////////////

const handleRightClick = (state: State, dispatch: Dispatch, gridPos: Vector): void => {
  const selectedAntIDs = getSelectedAntIDs(state.game);
  const clickedEntity = entitiesInMarquee(
    state.game,
    {position: gridPos, width: 1, height: 1},
  ).filter(e => config.antPickupEntities.includes(e.type))[0];
  const clickedFood = entitiesInMarquee(
    state.game,
    {position: gridPos, width: 1, height: 1},
  ).filter(e => config.antEatEntities.includes(e.type))[0];
  // TODO add config for which entities block the ant
  const blocked = clickedEntity != null || clickedFood != null;

  const clickedLocation = {
    ...makeLocation('Clicked Position', 1, 1, gridPos), id: config.clickedPosition,
  };
  dispatch({type: 'CREATE_ENTITY', entity: clickedLocation});
  if (selectedAntIDs.length > 0) {
    const task = createGoToLocationTask(clickedLocation);
    task.name = 'Go To Clicked Location';
    const eatClicked = createDoAction('EAT', clickedFood);
    const pickupClicked = createDoAction('PICKUP', clickedEntity);
    const putdownClicked = createDoAction('PUTDOWN', {position: gridPos, width: 1, height: 1});
    if (state.game.antMode === 'EAT') {
      task.behaviorQueue.push(eatClicked);
    } else if (state.game.antMode === 'PICKUP') {
      if (
        clickedEntity != null &&
        (clickedEntity.type === 'LARVA' || clickedEntity.type === 'ANT')
      ) {
        task.behaviorQueue.push(createDoAction('FEED', null));
      } else {
        task.behaviorQueue.push({
          type: 'IF',
          condition: {
            type: 'HOLDING',
            comparator: 'EQUALS',
            payload: {
              object: 'NOTHING',
            },
          },
          behavior: pickupClicked,
          elseBehavior: putdownClicked,
        });
      }
    } else if (state.game.antMode === 'FEED') {
      if (
        clickedEntity != null && clickedEntity.type === 'FOOD'
      ) {
        task.behaviorQueue.push({
          type: 'IF',
          condition: {
            type: 'HOLDING',
            comparator: 'EQUALS',
            payload: {
              object: 'NOTHING',
            },
          },
          behavior: pickupClicked,
          elseBehavior: putdownClicked,
        });
      } else {
        task.behaviorQueue.push(createDoAction('FEED', null));
      }
    }
    dispatch({
      type: 'ASSIGN_TASK',
      ants: selectedAntIDs,
      task,
    });
    // make this task always refer to most recently clicked location
    dispatch({type: 'UPDATE_TASK', task});
  }
};

////////////////////////////////////////////////////////////////////////////
// click -> position helpers
////////////////////////////////////////////////////////////////////////////

let canvas = null;
const getClickedPos = (game, ev, noFloor): ?Vector => {
  const pixel = getMousePixel(ev);
  if (pixel == null) return null;
  return canvasToGrid(game, pixel, noFloor);
};
const getMousePixel = (ev): ?Vector => {
  if (!canvas) {
    canvas = document.getElementById('canvas');
    // don't open the normal right-click menu
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    if (!canvas) {
      return null;
    }
  }
  const rect = canvas.getBoundingClientRect();

  const canvasPos = {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
  };
  // return null if clicked outside the canvas:
  if (
    canvasPos.x < 0 || canvasPos.y < 0 ||
    canvasPos.x > config.canvasWidth || canvasPos.y > config.canvasHeight
  ) {
    return null;
  }
  return canvasPos;
};

module.exports = {initMouseControlsSystem};
