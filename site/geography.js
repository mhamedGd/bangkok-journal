// Coordinates are always [longitude, latitude]. Polygon edges count as inside.
function onSegment(x,y,a,b) {
  const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
  return Math.abs(cross)<1e-10 && x>=Math.min(a[0],b[0])-1e-10 && x<=Math.max(a[0],b[0])+1e-10 && y>=Math.min(a[1],b[1])-1e-10 && y<=Math.max(a[1],b[1])+1e-10;
}
function inRing(x,y,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if(onSegment(x,y,a,b))return true;
    if(((a[1]>y)!==(b[1]>y)) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function pointInCity(lng,lat,feature) {
  const geometry=feature.geometry || feature;
  const polygons=geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings=>inRing(lng,lat,rings[0]) && !rings.slice(1).some(hole=>inRing(lng,lat,hole)));
}
// Leaflet constrains the whole viewport to maxBounds. Expand by half a viewport
// so every point on the city's bounding edges can reach the viewport center.
export function viewportPaddedBounds(northwest,southeast,width,height) {
  return {
    northwest:{x:northwest.x-width/2,y:northwest.y-height/2},
    southeast:{x:southeast.x+width/2,y:southeast.y+height/2},
  };
}
