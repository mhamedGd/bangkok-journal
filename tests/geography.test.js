import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pointInCity, viewportPaddedBounds } from '../site/geography.js';
const city=JSON.parse(readFileSync(new URL('../site/data/bangkok-boundary.geojson',import.meta.url)));
const network=JSON.parse(readFileSync(new URL('../site/data/bangkok-rail.geojson',import.meta.url)));
test('the Bangkok polygon includes the center and rejects neighboring places',()=>{
  assert.equal(pointInCity(100.515,13.745,city),true);
  assert.equal(pointInCity(100.7501,13.6900,city),false); // Suvarnabhumi is outside the city.
  assert.equal(pointInCity(100.53,14.2,city),false);
  assert.equal(pointInCity(100.1,13.7,city),false);
});
test('the city boundary itself is selectable',()=>{
  const [lng,lat]=city.geometry.coordinates[0][42];assert.equal(pointInCity(lng,lat,city),true);
});
test('each city edge can reach the viewport center at phone and desktop widths',()=>{
  for(const [w,h] of [[390,400],[1200,750]]){
    const nw={x:1000,y:2000},se={x:5000,y:6000};
    const padded=viewportPaddedBounds(nw,se,w,h);
    assert.equal(padded.northwest.x+w/2,nw.x);
    assert.equal(padded.northwest.y+h/2,nw.y);
    assert.equal(padded.southeast.x-w/2,se.x);
    assert.equal(padded.southeast.y-h/2,se.y);
  }
});
test('urban rail uses all ten OTP feed routes with their published colors',()=>{
  assert.equal(network.features.length,10);
  const colors=Object.fromEntries(network.features.map(f=>[f.properties.name,f.properties.color]));
  assert.equal(colors['BTS Sukhumvit'],'#65B724');assert.equal(colors['MRT Blue'],'#1964B7');assert.equal(colors['MRT Pink'],'#CD4692');
  for(const feature of network.features){
    assert.match(feature.properties.color,/^#[0-9A-F]{6}$/);
    assert.ok(feature.geometry.coordinates.length>0);
    for(const line of feature.geometry.coordinates)assert.ok(line.length>=2);
  }
});
const region=JSON.parse(readFileSync(new URL('../site/data/bangkok-region.geojson',import.meta.url)));
const places=JSON.parse(readFileSync(new URL('../site/data/places.geojson',import.meta.url)));
test('the expanded map includes both airports and suburban malls',()=>{
  const ids=['suvarnabhumi-airport-bkk','don-mueang-airport-dmk','mega-bangna','central-westgate','future-park-rangsit'];
  for(const id of ids){
    const place=places.features.find(f=>f.properties.id===id);assert.ok(place,`${id} is missing`);
    assert.equal(pointInCity(...place.geometry.coordinates,region),true,`${id} is outside the displayed region`);
  }
});
test('curated places have sourced positions, unique IDs, and supported categories',()=>{
  assert.equal(places.features.length,30);
  const ids=new Set();
  for(const place of places.features){
    assert.ok(!ids.has(place.properties.id));ids.add(place.properties.id);
    assert.match(place.properties.source,/^https:\/\/www.openstreetmap.org\/(node|way|relation)\/\d+$/);
    assert.ok(['landmark','mall','airport'].includes(place.properties.category));
    assert.equal(pointInCity(...place.geometry.coordinates,region),true,place.properties.name);
  }
});
