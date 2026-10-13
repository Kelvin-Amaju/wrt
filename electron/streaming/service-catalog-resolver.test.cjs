const test=require('node:test');
const assert=require('node:assert/strict');

const resolver=require('./service-catalog-resolver.cjs');

const deezerShare='https://link.deezer.com/s/34qBFbdREYM0STSckr3SU';
const deezerAlbum='https://www.deezer.com/en/album/1037333712';
const youtubeArtist='https://music.youtube.com/@lumeafro?si=ONn15lpEh_JAOuZ1';
const tidalAlbum='https://tidal.com/album/308700727';
const audiomackAlbum='https://audiomack.com/asakemusic/album/mney-1073854';
const pandoraTrack='https://www.pandora.com/artist/billy-cobham/drum-n-voice-the-definitive-collection/electric-man-feat-brian-auger/TRXb2wXlw9KVn9g';

test('builds a Deezer public catalog request after a share link resolves to the real album',()=>{
  const request=resolver.buildPublicCatalogRequest('deezer',deezerAlbum);
  assert.deepEqual(request,{platform:'deezer',kind:'album',url:'https://api.deezer.com/album/1037333712'});
  assert.equal(resolver.buildPublicCatalogRequest('deezer',deezerShare),null,'short share link must be resolved first');
});

test('normalizes Deezer public API album tracks to exact Deezer track URLs',()=>{
  const tracks=resolver.normalizePublicCatalogResponse('deezer',{tracks:{data:[
    {id:4256749241,title:'Trip',link:'https://www.deezer.com/track/4256749241',artist:{name:'Example Artist'}},
    {id:4256749251,title:'Second Song',artist:{name:'Example Artist'}},
  ]}},deezerAlbum);
  assert.deepEqual(tracks.map(t=>t.url),['https://www.deezer.com/track/4256749241','https://www.deezer.com/track/4256749251']);
});

test('maps the exact YouTube Music artist handle link to a channel videos fallback',()=>{
  assert.equal(resolver.buildYouTubeArtistFallbackUrl(youtubeArtist),'https://www.youtube.com/@lumeafro/videos');
  assert.equal(resolver.buildYouTubeArtistFallbackUrl('https://music.youtube.com/channel/UCVvsecs7xUvvwi-Zw8YF2hw'),'https://www.youtube.com/channel/UCVvsecs7xUvvwi-Zw8YF2hw/videos');
});

test('recognizes TIDAL JSON API track resources from a real public album shape',()=>{
  const tracks=resolver.normalizePublicCatalogResponse('tidal',{data:[
    {type:'tracks',id:'78362249',attributes:{title:'Unchain My Heart (LIVE)',artists:[{name:'Joe Cocker'}]}},
  ]},tidalAlbum);
  assert.equal(tracks.length,1);
  assert.equal(tracks[0].url,'https://tidal.com/track/78362249');
  assert.equal(tracks[0].title,'Unchain My Heart (LIVE)');
});

test('builds Audiomack album data request and normalizes returned songs',()=>{
  const request=resolver.buildPublicCatalogRequest('audiomack',audiomackAlbum);
  assert.deepEqual(request,{platform:'audiomack',kind:'album',url:'https://api.audiomack.com/v1/music/album/asakemusic/mney-1073854'});
  const tracks=resolver.normalizePublicCatalogResponse('audiomack',{results:{tracks:[
    {id:7231147,title:'Gratitude',url_slug:'gratitude-7231147',uploader_url_slug:'asakemusic',artist_name:'Asake'},
    {id:7231148,title:'Rora',url:'https://audiomack.com/asakemusic/song/rora-7231148',artist_name:'Asake'},
  ]}},audiomackAlbum);
  assert.equal(tracks.length,2);
  assert.equal(tracks[0].url,'https://audiomack.com/asakemusic/song/gratitude-7231147');
});

test('keeps a real Pandora song URL canonical even when Pandora itself is region restricted',()=>{
  assert.equal(resolver.normalizeDirectTrackUrl('pandora',pandoraTrack),pandoraTrack);
});

test('resolves real short/share links through HTTP before opening the catalog browser',async()=>{
  assert.equal(typeof resolver.resolveShareRedirect,'function');
  const seen=[];
  const fetchImpl=async (url,options)=>{seen.push({url,options});return {url:'https://www.deezer.com/en/album/1037333712',ok:true};};
  const out=await resolver.resolveShareRedirect(deezerShare,{fetchImpl});
  assert.equal(out,'https://www.deezer.com/en/album/1037333712');
  assert.equal(seen.length,1);
  assert.equal(seen[0].options.redirect,'follow');
});

test('does not replace a valid Pandora link with the region-restricted redirect',async()=>{
  assert.equal(typeof resolver.resolveShareRedirect,'function');
  const out=await resolver.resolveShareRedirect(pandoraTrack,{fetchImpl:async()=>({url:'https://www.pandora.com/restricted',ok:true})});
  assert.equal(out,pandoraTrack);
});

const exactYoutubeChannel='https://music.youtube.com/channel/UC3o5HxAo2Eyq3YK4t2KnYLA?si=3J2n9MVhLb6IyBA6';

test('exact YouTube Music channel link prefers the ordinary YouTube videos surface before catalog navigation',()=>{
  assert.equal(typeof resolver.preferredCatalogNavigationUrl,'function');
  assert.equal(resolver.preferredCatalogNavigationUrl('youtube-music',exactYoutubeChannel),'https://www.youtube.com/channel/UC3o5HxAo2Eyq3YK4t2KnYLA/videos');
});

test('builds the public YouTube channel feed URL from the exact channel link',()=>{
  assert.equal(typeof resolver.buildYouTubeChannelFeedUrl,'function');
  assert.equal(resolver.buildYouTubeChannelFeedUrl(exactYoutubeChannel),'https://www.youtube.com/feeds/videos.xml?channel_id=UC3o5HxAo2Eyq3YK4t2KnYLA');
});

test('parses YouTube public channel feed entries into canonical YouTube Music song links',()=>{
  assert.equal(typeof resolver.parseYouTubeChannelFeed,'function');
  const xml=`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>abc123XYZ</yt:videoId><title>Song One</title><author><name>Demo Artist</name></author></entry><entry><yt:videoId>def456XYZ</yt:videoId><title>Song Two</title><author><name>Demo Artist</name></author></entry></feed>`;
  const tracks=resolver.parseYouTubeChannelFeed(xml);
  assert.deepEqual(tracks.map(row=>row.url),['https://music.youtube.com/watch?v=abc123XYZ','https://music.youtube.com/watch?v=def456XYZ']);
  assert.deepEqual(tracks.map(row=>row.title),['Song One','Song Two']);
});


const exactYoutubePlaylist='https://music.youtube.com/playlist?list=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ&si=q1Xzxo-VdgrZsRC_';

test('builds public YouTube RSS feed URLs for the exact channel and playlist links',()=>{
  assert.equal(typeof resolver.buildYouTubeFeedUrl,'function');
  assert.equal(resolver.buildYouTubeFeedUrl(exactYoutubeChannel),'https://www.youtube.com/feeds/videos.xml?channel_id=UC3o5HxAo2Eyq3YK4t2KnYLA');
  assert.equal(resolver.buildYouTubeFeedUrl(exactYoutubePlaylist),'https://www.youtube.com/feeds/videos.xml?playlist_id=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ');
});

test('maps the exact YouTube Music playlist to the ordinary YouTube playlist surface',()=>{
  assert.equal(resolver.preferredCatalogNavigationUrl('youtube-music',exactYoutubePlaylist),'https://www.youtube.com/playlist?list=OLAK5uy_lZx0aAFqJ6YEcvDfIe0BPIBsANwkm-4mQ');
});
