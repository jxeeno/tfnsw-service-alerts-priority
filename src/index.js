const path = require('path')
const axios = require('axios')
const axiosRetry = require('axios-retry')
const config = require('config')
const protobufjs = require('protobufjs')
const lodash = require('lodash')
const cheerio = require('cheerio')
const NodeCache = require('node-cache')
const srvCache = new NodeCache({stdTTL: 30, useClones: false});

const GTFSR_URL = 'https://api.transport.nsw.gov.au/v2/gtfs/alerts/all';
const EFA_ADD_INFO_URL = 'https://api.transport.nsw.gov.au/v1/tp/add_info?outputFormat=rapidJSON';

const API_KEY = config.get('tfnsw.apiKey');
axios.defaults.headers.common['Authorization'] = `apikey ${API_KEY}`;
axiosRetry(axios, { retries: 3 });

const root = protobufjs.loadSync(path.join(__dirname, '../gtfs-realtime.proto'));
const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

const SEV_MAPPING = {
    'normal': 'WARNING',
    'low': 'INFO'
}

const getMatchedAlerts = async () => {
    const cached = srvCache.get('cached');
    if(cached){
        return cached
    }

    const {data: addInfoData} = await axios.get(EFA_ADD_INFO_URL);
    const {data: gtfsData} = await axios.get(GTFSR_URL, {
        responseType: 'arraybuffer'
    });

    const emsIdMapping = new Map();
    for(const alert of addInfoData.infos.current){
        emsIdMapping.set(alert.id, alert);
    }

    const decoded = FeedMessage.decode(gtfsData);
    for(const entity of decoded.entity){
        const url = lodash.get(entity, 'alert.url.translation[0].text');
        const emsId = url.replace(/.*#\//, '');
        const matchedAlert = emsIdMapping.get(emsId);

        if(matchedAlert){
            if(SEV_MAPPING[matchedAlert.priority]){
                entity.alert.severityLevel = SEV_MAPPING[matchedAlert.priority];
            }

            if(matchedAlert.properties.speechText){
                const $ = cheerio.load(`<tts>${matchedAlert.properties.speechText}</tts>`);
                const ttsText = $('tts').text().trim();
                if(ttsText){
                    entity.alert.ttsDescriptionText = {translation: [{text: ttsText, language: 'en'}]}
                }
            }
        }

        const informedEntities = [];

        const stops = new Set();
        const routes = new Set();

        const existingEntities = lodash.get(entity, 'alert.informedEntity');

        for(const e of existingEntities){
            if(e.stopId){
                stops.add(e.stopId)
            }

            if(e.routeId){
                const ridk = JSON.stringify({routeId: e.routeId, agencyId: e.agencyId});
                routes.add(ridk)
            }

            if(e.trip){
                informedEntities.push(e)
            }
        }

        stops.forEach(s => informedEntities.push({stopId: s}))
        routes.forEach(r => informedEntities.push(JSON.parse(r)))

        lodash.set(entity, 'alert.informedEntity', informedEntities);
    }

    decoded.header.gtfsRealtimeVersion = '2.0'
    
    const all = decoded;
    const normal = FeedMessage.create(decoded);
    normal.entity = normal.entity.filter(entity => entity.alert.severityLevel !== 'INFO')

    srvCache.set('cached', {all, normal})
    return {
        all,
        normal
    }
}

const express = require('express')
const app = express()
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/v1/gtfs/alerts/:type', async (req, res) => {
    if(['all', 'normal'].includes(req.params.type)){
        const val = (await getMatchedAlerts())[req.params.type];
        if(req.query.json){
            res.send(val.toJSON())
        }else{
            res.setHeader('content-type', 'application/x-protobuf');
            res.send(FeedMessage.encode(val).finish())
        }
    }else{
        res.sendStatus(404);
        res.send({error: true, message: 'unknown alert type'})
    }
})

app.listen(4000, () => {
    console.log(`Listening at http://localhost:${4000}`)
})