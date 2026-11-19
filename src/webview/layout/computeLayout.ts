// Computes the positions of all cards for one of the three layouts (spec §4.4).
//
//   - grouped:   each group is laid out on its own (layered), then the groups
//                are packed next to each other;
//   - hierarchy: one layered layout for the whole diagram;
//   - organic:   a force simulation (d3-force) where linked cards attract
//                each other and all cards repel each other.
//
// This module has no browser dependency: it runs in the layout web worker
// and in the Node benchmark.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, SimulationNodeDatum } from 'd3-force';
import { Point } from '../../shared/savedState';
import { GROUP_STYLE } from '../model/groups';
import { Box, DirectedLink, layeredLayout, packBoxes } from './elkLayout';
import { LayoutEdgeInput, LayoutInput, LayoutNodeInput, LayoutPositions } from './layoutTypes';

export async function computeLayout(input: LayoutInput): Promise<LayoutPositions> {
  const links = toDirectedLinks(input.edges);
  let positions: Map<string, Point>;
  switch (input.kind) {
    case 'grouped':
      positions = await groupedLayout(input.nodes, links, inheritanceOnly(input.edges));
      break;
    case 'hierarchy':
      positions = await layeredLayout(input.nodes, inheritanceOnly(input.edges));
      break;
    case 'organic':
      positions = organicLayout(input.nodes, links);
      break;
  }
  return Object.fromEntries(positions);
}

/**
 * The global hierarchy layers the whole diagram by inheritance only. With
 * composition as well, a large project gives chains hundreds of layers deep:
 * measured on the synthetic project, 20 s of computation for a diagram 3 million
 * units tall, against 0.7 s with inheritance only (spec §8 asks for under 5 s).
 */
function inheritanceOnly(edges: LayoutEdgeInput[]): DirectedLink[] {
  return toDirectedLinks(edges.filter((edge) => edge.kind === 'inherit'));
}

/**
 * ELK draws the source of a link above its target. A base class should be above
 * its derived classes, and a whole above its parts, so inheritance links are reversed.
 */
function toDirectedLinks(edges: LayoutEdgeInput[]): DirectedLink[] {
  return edges.map((edge) => (edge.kind === 'inherit' ? { from: edge.to, to: edge.from } : { from: edge.from, to: edge.to }));
}

const LARGE_GROUP_SIZE = 300;

async function groupedLayout(
  nodes: LayoutNodeInput[],
  links: DirectedLink[],
  inheritanceLinks: DirectedLink[],
): Promise<Map<string, Point>> {
  const nodesByGroup = new Map<string, LayoutNodeInput[]>();
  for (const node of nodes) {
    const members = nodesByGroup.get(node.group) ?? [];
    members.push(node);
    nodesByGroup.set(node.group, members);
  }

  // 1. Lay out each group on its own, with the links between its members.
  const localPositions = new Map<string, Map<string, Point>>();
  const groupBoxes: Box[] = [];
  const sortedGroups = Array.from(nodesByGroup.keys()).sort();
  for (const group of sortedGroups) {
    const members = nodesByGroup.get(group)!;
    const memberIds = new Set(members.map((member) => member.id));
    // Large groups are layered by inheritance only, for the reason given in inheritanceOnly().
    const groupLinks = members.length > LARGE_GROUP_SIZE ? inheritanceLinks : links;
    const internalLinks = groupLinks.filter((link) => memberIds.has(link.from) && memberIds.has(link.to));
    const positions = await layeredLayout(members, internalLinks);
    localPositions.set(group, positions);
    const contentWidth = Math.max(...members.map((member) => positions.get(member.id)!.x + member.width));
    const contentHeight = Math.max(...members.map((member) => positions.get(member.id)!.y + member.height));
    groupBoxes.push({
      id: group,
      width: contentWidth + GROUP_STYLE.padding * 2,
      height: contentHeight + GROUP_STYLE.padding * 2 + GROUP_STYLE.titleHeight,
    });
  }

  // 2. Pack the group boxes, then move each member into its group box.
  const groupPositions = await packBoxes(groupBoxes);
  const positions = new Map<string, Point>();
  for (const [group, members] of localPositions) {
    const groupOrigin = groupPositions.get(group)!;
    for (const [id, local] of members) {
      positions.set(id, {
        x: groupOrigin.x + GROUP_STYLE.padding + local.x,
        y: groupOrigin.y + GROUP_STYLE.padding + GROUP_STYLE.titleHeight + local.y,
      });
    }
  }
  return positions;
}

interface ForceNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

// d3-force's default is 300 steps. 150 steps with a matching faster cooling give
// nearly the same picture in half the time (spec §8: layouts under 5 s for 1500 cards).
const ORGANIC_TICK_COUNT = 150;
const ORGANIC_ALPHA_DECAY = 1 - Math.pow(0.001, 1 / ORGANIC_TICK_COUNT);

function organicLayout(nodes: LayoutNodeInput[], links: DirectedLink[]): Map<string, Point> {
  // Cards of the same group start close together, each group on its own spot of a large circle.
  const groups = Array.from(new Set(nodes.map((node) => node.group))).sort();
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const spread = Math.sqrt(nodes.length) * 120;
  const forceNodes: ForceNode[] = nodes.map((node, index) => {
    const angle = (2 * Math.PI * groupIndex.get(node.group)!) / Math.max(1, groups.length);
    // A small deterministic offset, so that cards of a group do not start on the same point.
    const jitter = ((index * 7919) % 1000) / 1000 - 0.5;
    return {
      id: node.id,
      radius: Math.hypot(node.width, node.height) / 2,
      x: Math.cos(angle) * spread + jitter * 200,
      y: Math.sin(angle) * spread + ((index * 104729) % 1000) / 5 - 100,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const forceLinks = links.filter((link) => nodeIds.has(link.from) && nodeIds.has(link.to)).map((link) => ({ source: link.from, target: link.to }));

  const simulation = forceSimulation(forceNodes)
    .alphaDecay(ORGANIC_ALPHA_DECAY)
    .force(
      'link',
      forceLink<ForceNode, { source: string; target: string }>(forceLinks)
        .id((node) => node.id)
        .distance(60)
        .strength(0.3),
    )
    .force('charge', forceManyBody<ForceNode>().strength(-300).distanceMax(2000))
    .force('collide', forceCollide<ForceNode>((node) => node.radius + 15))
    // A weak pull toward the center keeps unlinked cards from drifting away.
    .force('x', forceX(0).strength(0.03))
    .force('y', forceY(0).strength(0.03))
    .stop();
  for (let tick = 0; tick < ORGANIC_TICK_COUNT; tick++) {
    simulation.tick();
  }

  const sizeById = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map<string, Point>();
  for (const forceNode of forceNodes) {
    const size = sizeById.get(forceNode.id)!;
    positions.set(forceNode.id, { x: (forceNode.x ?? 0) - size.width / 2, y: (forceNode.y ?? 0) - size.height / 2 });
  }
  return positions;
}
