import app from './app';
import fields from './fields';
import layout from './layout';
import room from './room';

// One file per part of the page, so a phrase is easy to find beside its neighbours.
export default { ...app, ...layout, ...fields, ...room } as const;
