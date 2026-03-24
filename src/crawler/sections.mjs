export const SECTIONS = [
  { id: 'portalscript-api', name: 'Portalscript API', urlPath: '/api/portalscript/', type: 'typedoc' },
  { id: 'scriptextensions-api', name: 'Script Extensions API', urlPath: '/api/scriptextensions/', type: 'jsdoc' },
  { id: 'gadget-api', name: 'Gadget API', urlPath: '/api/gadgets/', type: 'jsdoc' },
  { id: 'client-sdk', name: 'Client SDK', urlPath: '/api/client-sdk/', type: 'jsdoc' },
  { id: 'drop-sdk', name: 'Documents Drop SDK', urlPath: '/api/documents-native/', type: 'jsdoc' },
  { id: 'record-library', name: 'Record-Library', urlPath: '/api/record-library/', type: 'jsdoc' },
  { id: 'otr-tools', name: 'otr Tools', urlPath: '/api/otr', type: 'mixed',
    subsections: [
      { name: 'otrAssert', urlPath: '/api/otrAssert/' },
      { name: 'otrLogger', urlPath: '/api/otrLogger/' },
      { name: 'otrPackage', urlPath: '/api/otrpackage/' },
      { name: 'otrUpgrade', urlPath: '/api/otrUpgrade/' },
      { name: 'otrTest', urlPath: '/api/otrTest/' },
    ]},
  { id: 'howtos', name: 'HowTos', urlPath: '/howto/', type: 'otris-book' },
  { id: 'properties', name: 'Properties', urlPath: '/api/properties/', type: 'properties' },
  { id: 'manuals', name: 'Manuals', urlPath: '/manuals/', type: 'manuals' },
];

export const BASE_URL = 'https://otris.software/documents';
