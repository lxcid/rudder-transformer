// ========================================================================
// Make sure you are putting any new method in relevant section
// INLINERS ==> Inline methods
// REQUEST FORMATS ==> Various request formats to format the final response
// TRANSFORMER UTILITIES ==> Utility methods having dependency on event/message
// GENERIC ==> Other methods which doesn't fit in other categories
// ========================================================================

const Handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const set = require("set-value");
const get = require("get-value");

// ========================================================================
// INLINERS
// ========================================================================

const isDefined = x => !_.isUndefined(x);
const isNotNull = x => x != null;
const isDefinedAndNotNull = x => isDefined(x) && isNotNull(x);
const removeUndefinedValues = obj => _.pickBy(obj, isDefined);
const removeNullValues = obj => _.pickBy(obj, isNotNull);
const removeUndefinedAndNullValues = obj => _.pickBy(obj, isDefinedAndNotNull);

// ========================================================================
// REQUEST FORMAT METHODS
// ========================================================================

// GET
const defaultGetRequestConfig = {
  requestFormat: "PARAMS",
  requestMethod: "GET"
};

// POST
const defaultPostRequestConfig = {
  requestFormat: "JSON",
  requestMethod: "POST"
};

// DELETE
const defaultDeleteRequestConfig = {
  requestFormat: "JSON",
  requestMethod: "DELETE"
};

// PUT
const defaultPutRequestConfig = {
  requestFormat: "JSON",
  requestMethod: "PUT"
};

// DEFAULT
const defaultRequestConfig = () => {
  return {
    version: "1",
    type: "REST",
    method: "POST",
    endpoint: "",
    headers: {},
    params: {},
    body: {
      JSON: {},
      XML: {},
      FORM: {}
    },
    files: {}
  };
};

// ========================================================================
// TRANSFORMER UTILITIES
// ========================================================================
const MESSAGE_MAPPING = JSON.parse( fs.readFileSync(path.resolve(__dirname, `./data/message.json`)));

// Get the IP address from the message.
// NEED TO DEPRECATE
const getParsedIP = message => {
  if (message.context && message.context.ip) {
    return message.context.ip;
  }
  return message.request_ip;
};

// Important !@!
// create the mappingConfig from data JSONs for destinations
const getMappingConfig = (config, dir) => {
  const mappingConfig = {};
  const categoryKeys = Object.keys(config);
  categoryKeys.forEach(categoryKey => {
    const category = config[categoryKey];
    mappingConfig[category.name] = JSON.parse(
      fs.readFileSync(path.resolve(dir, `./data/${category.name}.json`))
    );
  });
  return mappingConfig;
};

// NEED a better way to handle it. Only used in Autopilot and Intercom
// NEED TO DEPRECATE
const updatePayload = (currentKey, eventMappingArr, value, payload) => {
  eventMappingArr.forEach(obj => {
    if (obj.rudderKey === currentKey) {
      set(payload, obj.expectedKey, value);
    }
  });
  return payload;
};

// Important !@!
// - get value from a list of sourceKeys in precedence order
// - get value from a string key
const getValueFromMessage = (message, sourceKey) => {
  // TODO: add multiple datatypes or do it in it's sister method. (start with datetime?)
  if (Array.isArray(sourceKey) || sourceKey.length === 0) {
    // got the possible sourceKeys
    for (let index = 0; index < sourceKey.length; index += 1) {
      const val = get(message, sourceKey[index]);
      if (val) {
        // return only if the value is valid.
        // else look for next possible source in precedence
        return val;
      }
    }
  } else if (typeof sourceKey === "string") {
    // got a single key
    // - we don't need to iterate over a loop for a single possible value
    return get(message, sourceKey);
  } else {
    // wrong sourceKey type. abort
    // DEVELOPER ERROR
    throw new Error("Wrong sourceKey type or blank sourceKey array");
  }
  return null;
};

// construct payload from an event and mappingJson
const constructPayload = (message, mappingJson) => {
  // Mapping JSON should be an array
  if (Array.isArray(mappingJson)) {
    // - construct a blank payload and return at the end
    // - if you to need merge multiple constructPayload do it on the transformer code
    // - - will give a cleaner approach
    // - - you don't need to iterate over multiple loops to construct a payload for a single event
    const payload = {};

    // loop through the mappingJson
    // Expected mappingJson :
    // [
    //   {
    //     "sourceKeys" : ["userId", "context.traits.userId", "context.traits.id", "anonymousId"],
    //     "destKey" : "uniqueid",
    //     "required": true
    //   },
    //   {
    //     "sourceKeys" : "event"
    //     "destKey" : "eventName",
    //     "required": true
    //   },
    //   {
    //     "sourceKeys" : "event"
    //     "destKey" : "eventName",
    //     "required": true,
    //     "template": "Visited {{value}} page"
    //   },
    //   ...
    // ]
    mappingJson.forEach(mapping => {
      const { sourceKeys, destKey, required, template } = mapping;
      // get the value from event
      const value = getValueFromMessage(message, sourceKeys);
      if (value) {
        // set the value only if correct
        if (template) {
          // check for template
          const hTemplate = Handlebars.compile(template.trim());
          payload[destKey] = hTemplate({ value });
        } else {
          payload[destKey] = value;
        }
      } else if (required) {
        // throw error if reqired value is missing
        throw new Error(
          `Missing required value from ${JSON.stringify(sourceKeys)}`
        );
      }
    });
  }
  return null;
};

// get a field value from message.
// check `data/message.json` for actual field precedence
// Example usage: getFieldValueFromMessage(message, "userId")
//                This will return "userId", "context.traits.userId", "context.traits.id", "anonymousId"
const getFieldValueFromMessage = (message, field) => {
  const sourceKey = MESSAGE_MAPPING[field];
  if (mapping) {
    return getValueFromMessage(message, sourceKey);
  }
  return null;
};

// Generic methos to find out a value from a message
// NEED to decouple value finding and `required` checking
// NEED TO DEPRECATE
const setValues = (payload, message, mappingJson) => {
  if (Array.isArray(mappingJson)) {
    let val;
    let sourceKeys;
    mappingJson.forEach(mapping => {
      val = undefined;
      sourceKeys = mapping.sourceKeys;
      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        for (let index = 0; index < sourceKeys.length; index += 1) {
          val = get(message, sourceKeys[index]);
          if (val) {
            break;
          }
        }
        if (val) {
          set(payload, mapping.destKey, val);
        } else if (mapping.required) {
          throw new Error(
            `One of ${JSON.stringify(mapping.sourceKeys)} is required`
          );
        }
      }
    });
  }
  return payload;
};

// ========================================================================
// GENERIC UTLITY
// ========================================================================

const isPrimitive = arg => {
  const type = typeof arg;
  return arg == null || (type !== "object" && type !== "function");
};

const formatValue = value => {
  if (!value || value < 0) return 0;
  return Math.round(value);
};

// Format the destination.Config.dynamicMap arrays to hashMap
const getHashFromArray = (arrays, fromKey = "from", toKey = "to") => {
  const hashMap = {};
  arrays.forEach(array => {
    hashMap[array[fromKey]] = array[toKey];
  });
  return hashMap;
};

// Important !@!
// format date in yyyymmdd format
const getDateInFormat = date => {
  const x = new Date(date);
  const y = x.getFullYear().toString();
  let m = (x.getMonth() + 1).toString();
  let d = x.getDate().toString();
  d = d.length === 1 ? d : `0${d}`;
  m = m.length === 1 ? m : `0${m}`;
  const yyyymmdd = y + m + d;
  return yyyymmdd;
};

// ========================================================================
// EXPORTS
// ========================================================================
// keep it sorted to find easily
module.exports = {
  constructPayload,
  defaultDeleteRequestConfig,
  defaultGetRequestConfig,
  defaultPostRequestConfig,
  defaultPutRequestConfig,
  defaultRequestConfig,
  formatValue,
  getDateInFormat,
  getFieldValueFromMessage,
  getHashFromArray,
  getMappingConfig,
  getParsedIP,
  getValueFromMessage,
  isPrimitive,
  removeNullValues,
  removeUndefinedAndNullValues,
  removeUndefinedValues,
  setValues,
  updatePayload
};