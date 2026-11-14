import type { CatalogObject } from '../data/catalog';
import { ORG, PARTNER_ORG, type FleetSpec } from '../data/company';
import type { ObjectRef } from './alerts';
import { catalogId } from './scenario';

export function fleetRef(s: FleetSpec): ObjectRef {
  return {
    id: s.id,
    name: s.name,
    norad: s.norad,
    intlId: `2026-SIM-${s.norad}`,
    cls: s.owner === 'own' ? 'OWN' : 'PARTNER',
    operator: s.owner === 'own' ? ORG.name : PARTNER_ORG.name,
    hbrM: s.hbrM,
  };
}

export function catalogRef(o: CatalogObject): ObjectRef {
  const hbr = o.norad === 27386 ? 13 : o.kind === 'DEBRIS' ? 0.6 : o.kind === 'DEFUNCT' ? 4 : 3;
  return {
    id: catalogId(o.norad),
    name: o.name,
    norad: o.norad,
    intlId: o.intlId,
    cls: o.kind,
    operator: o.kind === 'PAYLOAD' ? 'Third-party operator' : 'NONE',
    hbrM: hbr,
  };
}
