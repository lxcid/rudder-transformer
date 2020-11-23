const get = require("get-value");
const set = require("set-value");
const axios = require("axios");
const { EventType } = require("../../../constants");
const {
  defaultGetRequestConfig,
  defaultPostRequestConfig,
  defaultRequestConfig,
  removeUndefinedValues,
  getFieldValueFromMessage
} = require("../../util");
const { ConfigCategory, mappingConfig } = require("./config");

const hSIdentifyConfigJson = mappingConfig[ConfigCategory.IDENTIFY.name];

let hubSpotPropertyMap = {};

function getKey(key) {
  let modifiedKey = key.toLowerCase();
  modifiedKey = modifiedKey.replace(/\s/g, "_");
  modifiedKey = modifiedKey.replace(/\./g, "_");
  return modifiedKey;
}

async function getProperties(destination) {
  if (!hubSpotPropertyMap.length) {
    const { apiKey } = destination.Config;
    const url = `https://api.hubapi.com/properties/v1/contacts/properties?hapikey=${apiKey}`;
    const response = await axios.get(url);
    const propertyMap = {};
    response.data.forEach(element => {
      propertyMap[element.name] = element.type;
    });
    hubSpotPropertyMap = propertyMap;
  }
  return hubSpotPropertyMap;
}

async function getTransformedJSON(message, mappingJson, destination) {
  const rawPayload = {};

  const traits = getFieldValueFromMessage(message, "traits");
  if (traits) {
    // add all the fields from mappingJson
    const sourceKeys = Object.keys(mappingJson);
    sourceKeys.forEach(sourceKey => {
      if (get(traits, sourceKey)) {
        set(rawPayload, mappingJson[sourceKey], get(traits, sourceKey));
      }
    });
    const traitsKeys = Object.keys(traits);
    const propertyMap = await getProperties(destination);
    traitsKeys.forEach(traitsKey => {
      const hsSupportedKey = getKey(traitsKey);
      if (!rawPayload[traitsKey] && propertyMap[hsSupportedKey]) {
        let propValue = traits[traitsKey];
        if (propertyMap[hsSupportedKey] === "date") {
          const time = propValue;
          const date = new Date(time);
          date.setUTCHours(0, 0, 0, 0);
          propValue = date.getTime();
        }
        rawPayload[hsSupportedKey] = propValue;
      }
    });
  }
  return { ...rawPayload };
}

function getPropertyValueForIdentify(propMap) {
  return Object.keys(propMap).map(key => {
    return { property: key, value: propMap[key] };
  });
}

function responseBuilderSimple(payload, message, eventType, destination) {
  let endpoint = "https://track.hubspot.com/v1/event";
  let params = {};

  const response = defaultRequestConfig();
  response.method = defaultGetRequestConfig.requestMethod;

  if (eventType !== EventType.TRACK) {
    const traits = getFieldValueFromMessage(message, "traits");
    const { email } = traits;
    const { apiKey } = destination.Config;
    params = { hapikey: apiKey };
    if (email) {
      endpoint = `https://api.hubapi.com/contacts/v1/contact/createOrUpdate/email/${email}`;
    } else {
      endpoint = "https://api.hubapi.com/contacts/v1/contact";
    }
    response.method = defaultPostRequestConfig.requestMethod;
    response.body.JSON = removeUndefinedValues(payload);
  } else {
    params = removeUndefinedValues(payload);
  }
  response.headers = {
    "Content-Type": "application/json"
  };
  response.endpoint = endpoint;
  response.userId = message.anonymousId;
  response.params = params;
  response.statusCode = 200;

  return response;
}

async function processTrack(message, destination) {
  const parameters = {
    _a: destination.Config.hubID,
    _n: message.event
  };

  if (message.properties.revenue || message.properties.value) {
    // eslint-disable-next-line dot-notation
    parameters["_m"] = message.properties.revenue || message.properties.value;
  }
  const userProperties = await getTransformedJSON(
    message,
    hSIdentifyConfigJson,
    destination
  );

  return responseBuilderSimple(
    { ...parameters, ...userProperties },
    message,
    EventType.TRACK,
    destination
  );
}

// function handleError(message) {
//   throw new Error(message);
// }

async function processIdentify(message, destination) {
  const response = [];
  const traits = getFieldValueFromMessage(message, "traits");
  if (!traits || !traits.email) {
    throw new Error("Identify without email is not supported.");
  }
  const userProperties = await getTransformedJSON(
    message,
    hSIdentifyConfigJson,
    destination
  );
  const properties = getPropertyValueForIdentify(userProperties);
  response.push(
    responseBuilderSimple(
      { properties },
      message,
      EventType.IDENTIFY,
      destination
    )
  );

  // check for CRM custom-objects and act accordingly
  // Ref: https://developers.hubspot.com/docs/api/crm/crm-custom-objects
  if (traits.hubspot) {
    const { contactId, qualifiedName, objects } = traits.hubspot;
    if (!contactId) {
      throw new Error(
        "HubSpot contactId is not provided. Aborting custom-object association"
      );
    }

    if (!qualifiedName) {
      throw new Error(
        "HubSpot qualifiedName is not provided. Aborting custom-object association"
      );
    }

    if (!objects || !Array.isArray(objects) || objects.length === 0) {
      throw new Error(
        "HubSpot objects are not provided.  Aborting custom-object association"
      );
    }

    // every thing is checked. create the request
    const endpoint = `https://api.hubapi.com/crm/v3/associations/${qualifiedName}/contact/batch/create`;
    const params = { hapikey: destination.Config.apiKey };
    const inputs = [];
    objects.forEach(item => {
      inputs.push({
        from: { id: item.objectId },
        to: { id: contactId },
        type: `${item.objectType}_to_contact`
      });
    });

    const requestObject = defaultRequestConfig();
    requestObject.params = params;
    requestObject.endpoint = endpoint;
    requestObject.body.JSON = { inputs };
    requestObject.headers = {
      "Content-Type": "application/json"
    };
    requestObject.userId = message.anonymousId;
    requestObject.statusCode = 200;

    response.push(requestObject);
  }

  return response;
}

async function processSingleMessage(message, destination) {
  let response;
  try {
    switch (message.type) {
      case EventType.TRACK:
        response = await processTrack(message, destination);
        break;
      case EventType.IDENTIFY:
        response = await processIdentify(message, destination);
        break;
      default:
        throw new Error(`message type ${message.type} is not supported`);
    }
  } catch (e) {
    throw new Error(e.message || "error occurred while processing payload.");
  }
  return response;
}

function process(event) {
  return processSingleMessage(event.message, event.destination);
}
exports.process = process;
