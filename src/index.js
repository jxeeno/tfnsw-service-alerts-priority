const path = require('path')
const axios = require('axios')
const config = require('config')
const protobufjs = require('protobufjs')
const lodash = require('lodash')
const cheerio = require('cheerio')

const GTFSR_URL = 'https://api.transport.nsw.gov.au/v1/gtfs/alerts/all';
const EFA_ADD_INFO_URL = 'https://api.transport.nsw.gov.au/v1/tp/add_info?outputFormat=rapidJSON';

const API_KEY = config.get('tfnsw.apiKey');
axios.defaults.headers.common['Authorization'] = `apikey ${API_KEY}`;

const root = protobufjs.loadSync(path.join(__dirname, '../gtfs-realtime.proto'));
const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

const SEV_MAPPING = {
    'normal': 'WARNING',
    'low': 'INFO'
}

const getMatchedAlerts = async () => {
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
    }

    decoded.header.gtfsRealtimeVersion = '2.0'
    
    const all = decoded;
    const normal = FeedMessage.create(decoded);
    normal.entity = normal.entity.filter(entity => entity.alert.severityLevel !== 'INFO')

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