export interface RouteSection {
  id: string;
  title: string;
}

export interface RoutePage {
  path: string;
  name: string;
  title: string;
  section: string;
  sourceType?: string;
  source?: string;
  icon?: string;
  menu?: boolean;
}

export interface RouteClient {
  id: string;
  name: string;
  basePath: string;
  sections: RouteSection[];
  pages: RoutePage[];
}

export interface RouteGroup {
  id: string;
  title: string;
  sectionIndex: number;
  isUngrouped: boolean;
  pages: RoutePage[];
}

export function routeGroups(client: RouteClient): RouteGroup[] {
  const sectionIds = new Set(client.sections.map((section) => section.id));
  const groups = client.sections.map((section, sectionIndex) => ({
    id: section.id,
    title: section.title,
    sectionIndex,
    isUngrouped: false,
    pages: client.pages.filter((page) => page.section === section.id),
  }));
  const ungrouped = client.pages.filter((page) => !sectionIds.has(page.section));
  if (ungrouped.length)
    groups.push({
      id: '__ungrouped__',
      title: '未分组',
      sectionIndex: -1,
      isUngrouped: true,
      pages: ungrouped,
    });
  return groups;
}

export function routeOrderSignature(client: RouteClient) {
  return JSON.stringify({
    sections: client.sections.map((section) => section.id),
    pages: Object.fromEntries(
      routeGroups(client)
        .filter((group) => !group.isUngrouped)
        .map((group) => [group.id, group.pages.map((page) => page.name)]),
    ),
  });
}

export function moveInArray<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
  return copy;
}

export function moveRoutePage(
  client: RouteClient,
  sectionId: string,
  index: number,
  direction: -1 | 1,
): RouteClient {
  if (sectionId === '__ungrouped__') return client;
  const currentGroup = client.pages.filter((page) => page.section === sectionId);
  const nextGroup = moveInArray(currentGroup, index, direction);
  if (nextGroup === currentGroup) return client;
  const queue = [...nextGroup];
  return {
    ...client,
    pages: client.pages.map((page) => (page.section === sectionId ? queue.shift() || page : page)),
  };
}

export function moveRouteSection(client: RouteClient, index: number, direction: -1 | 1): RouteClient {
  return { ...client, sections: moveInArray(client.sections, index, direction) };
}

export function formatOrder(index: number) {
  return String(index + 1).padStart(2, '0');
}
