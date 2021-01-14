const { EventType } = require("../../../constants");
const { CONFIG_CATEGORIES, MAPPING_CONFIG } = require("./config");
const get = require("get-value");
const set = require("set-value");
const LOG = require("../../../logger");
const {
  defaultRequestConfig,
  getFieldValueFromMessage,
  constructPayload,
  defaultPostRequestConfig
} = require("../../util");
const { default: Axios } = require("axios");

// The Finl data is both application/url-encoded FORM and POST JSON depending on type of event
// Creating a switch case for final request building
const responseBuilderSimple = (message, payload, category, destination) => {
  if (payload) {
    const responseBody = { ...payload, apiKey: destination.Config.apiKey };
    const response = defaultRequestConfig();
    switch (category.name) {
      case "ACIdentify":
      case "ACPage":
        response.endpoint = `${destination.Config.apiUrl}${
          category.endPoint ? category.endPoint : ""
        }`;
        response.method = defaultPostRequestConfig.requestMethod;
        response.headers = {
          "Content-Type": "application/json",
          "Api-Token": destination.Config.apiKey
        };
        response.body.JSON = responseBody;
        break;
      case "ACScreen":
      case "ACTrack":
        response.endpoint = `${category.endPoint}`;
        response.method = defaultPostRequestConfig.requestMethod;
        response.headers = {
          "Content-Type": "application/x-www-form-urlencoded",
          "Api-Token": destination.Config.apiKey
        };
        response.body.FORM = responseBody;
        break;
      default:
        throw new Error("Message format type not supported");
    }

    return response;
  }
  // fail-safety for developer error
  throw new Error("Payload could not be constructed");
};

// This the handler func for identify type of events here before we transform the event
// and return to rudder server we process the message by calling specific destination apis
// for handling tag information and custom field information.
const identifyRequestHandler = async (message, category, destination) => {
  const createdContact = await customTagProcessor(
    message,
    category,
    destination
  );
  await customFieldProcessor(message, category, destination, createdContact);
  let payload = {
    contact: constructPayload(message, MAPPING_CONFIG[category.name])
  };
  payload.contact["firstName"] = getFieldValueFromMessage(message, "firstName");
  payload.contact["lastName"] = getFieldValueFromMessage(message, "lastName");
  return responseBuilderSimple(message, payload, category, destination);
};
// This method handles any page request
// Creates the payload as per API spec and returns to rudder-server
// Ref - https://developers.activecampaign.com/reference#site-tracking
const pageRequestHandler = (message, category, destination) => {
  payload = {
    siteTrackingDomain: constructPayload(message, MAPPING_CONFIG[category.name])
  };
  set(
    payload.siteTrackingDomain,
    "name",
    get(payload.siteTrackingDomain, "name")
      .replace("https://", "")
      .replace("http://", "")
  );
  return responseBuilderSimple(message, payload, category, destination);
};

const screenRequestHandler = async (message, category, destination) => {
  //Need to check if the event with same name already exists if not need to create
  //Retrieve All events from destination
  //https://developers.activecampaign.com/reference#list-all-event-types
  let res;
  try {
    res = await Axios.get(
      `${destination.Config.apiUrl}${
        category.getEventEndPoint ? category.getEventEndPoint : ""
      }`,
      {
        headers: {
          "Content-Type": "application/json",
          "Api-Token": destination.Config.apiKey
        }
      }
    );
  } catch (err) {
    LOG.error(`Error while fetching dest events ${err}`);
  }
  if (res.status != 200) throw new Error("Unable to fetch dest events");

  const storedEventsArr = res.data.eventTrackingEvents;
  const storedEvents = [];
  storedEventsArr.map(ev => {
    storedEvents.push(ev.name);
  });
  //Check if the source event is already present if not we make a create request
  //Ref - https://developers.activecampaign.com/reference#create-a-new-event-name-only
  if (!storedEvents.includes(message.properties.eventName)) {
    //Create the event
    try {
      res = await Axios.post(
        `${destination.Config.apiUrl}${
          category.getEventEndPoint ? category.getEventEndPoint : ""
        }`,
        {
          eventTrackingEvent: {
            name: message.name
          }
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Api-Token": destination.Config.apiKey
          }
        }
      );
    } catch (err) {
      LOG.error(`Error while creating dest event ${err}`);
    }

    if (res.status != 201) throw new Error("Unable to create dest event");
  }
  // Previous operations successfull then
  // Mapping the Event payloads
  // Create the payload and send the ent to end point using rudder server
  // Ref - https://developers.activecampaign.com/reference#track-event
  let payload = constructPayload(message, MAPPING_CONFIG[category.name]);
  payload.actid = destination.Config.actid;
  payload.key = destination.Config.eventKey;
  payload.visit = encodeURIComponent(
    `{email : ${
      message.context.traits.email
        ? message.context.traits.email
        : message.context.traits.traits.email
    }}`
  );
  return responseBuilderSimple(message, payload, category, destination);
};

const trackRequestHandler = async (message, category, destination) => {
  //Need to check if the event with same name already exists if not need to create
  //Retrieve All events from destination
  //https://developers.activecampaign.com/reference#list-all-event-types
  let res;
  try {
    res = await Axios.get(
      `${destination.Config.apiUrl}${
        category.getEventEndPoint ? category.getEventEndPoint : ""
      }`,
      {
        headers: {
          "Api-Token": destination.Config.apiKey
        }
      }
    );
  } catch (err) {
    LOG.error(`Error while fetching dest events ${err}`);
  }
  if (res.status != 200) throw new Error("Unable to fetch dest events");

  const storedEventsArr = res.data.eventTrackingEvents;
  const storedEvents = [];
  storedEventsArr.map(ev => {
    storedEvents.push(ev.name);
  });
  //Check if the source event is already present if not we make a create request
  //Ref - https://developers.activecampaign.com/reference#create-a-new-event-name-only
  if (!storedEvents.includes(message.properties.eventName)) {
    //Create the event
    try {
      res = await Axios.post(
        `${destination.Config.apiUrl}${
          category.getEventEndPoint ? category.getEventEndPoint : ""
        }`,
        {
          eventTrackingEvent: {
            name: message.event
          }
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Api-Token": destination.Config.apiKey
          }
        }
      );
    } catch (err) {
      LOG.error(`Error while creating dest event ${err}`);
    }

    if (res.status != 201) throw new Error("Unable to create dest event");
  }
  // Previous operations successfull then
  // Mapping the Event payloads
  // Create the payload and send the ent to end point using rudder server
  // Ref - https://developers.activecampaign.com/reference#track-event
  let payload = constructPayload(message, MAPPING_CONFIG[category.name]);
  payload.actid = destination.Config.actid;
  payload.key = destination.Config.eventKey;
  payload.visit = encodeURIComponent(
    `{email : ${
      message.context.traits.email
        ? message.context.traits.email
        : message.context.traits.traits.email
    }}`
  );
  return responseBuilderSimple(message, payload, category, destination);
};

const customTagProcessor = async (message, category, destination) => {
  const tagsToBeCreated = [];
  const tagIds = [];
  //Step - 1
  //In order to bind custom tags and field values to a contact we first create the contact
  //------------------------------------------------------------------
  //Ref - https://developers.activecampaign.com/reference#create-or-update-contact-new
  //Utilizing the response we further bind more data [tag , field] to it
  let res;
  let contactPayload = constructPayload(message, MAPPING_CONFIG[category.name]);
  contactPayload["firstName"] = getFieldValueFromMessage(message, "firstName");
  contactPayload["lastName"] = getFieldValueFromMessage(message, "lastName");
  try {
    res = await Axios.post(
      `${destination.Config.apiUrl}${
        category.endPoint ? category.endPoint : ""
      }`,
      {
        contact: contactPayload
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Api-Token": destination.Config.apiKey
        }
      }
    );
  } catch (err) {
    throw new Error("Failed to Create new Contact");
  }
  const created_contact = res.data.contact;

  //Here we extract the tags which are to be mapped to the created contact from the message
  const tags = get(message.context.traits, "tags")
    ? get(message.context.traits, "tags")
    : get(message.traits, "tags");

  //Step - 2
  //Fetch already created tags from dest, so that we avoid duplicate tag creation request
  //Ref - https://developers.activecampaign.com/reference#retrieve-all-tags
  try {
    res = await Axios.get(
      `${destination.Config.apiUrl}${
        category.tagEndPoint ? category.tagEndPoint : ""
      }`,
      {
        headers: {
          "Content-Type": "application/json",
          "Api-Token": destination.Config.apiKey
        }
      }
    );
  } catch (err) {
    throw new Error("Failed to Create new Contact");
  }

  //For easily checking if the tag which is sent is already present
  //creating K-V Map [tag_name] -> tag_id
  let storedTags = {};
  res.data.tags.map(t => {
    storedTags[t.tag] = t.id;
  });

  //Step - 3
  //Check if tags already present then we push it to tagIds
  //the ones which are not stored we push it to tagsToBeCreated
  tags.map(tag => {
    if (!storedTags[tag]) tagsToBeCreated.push(tag);
    else tagIds.push(storedTags[tag]);
  });

  // Step - 4
  // Create tags if required - from tagsToBeCreated
  // Ref - https://developers.activecampaign.com/reference#create-a-new-tag
  if (tagsToBeCreated.length > 0) {
    await Promise.all(
      tagsToBeCreated.map(async tag => {
        try {
          res = await Axios.post(
            `${destination.Config.apiUrl}${
              category.tagEndPoint ? category.tagEndPoint : ""
            }`,
            {
              tag: {
                tag: tag,
                tagType: "contact",
                description: ""
              }
            },
            {
              headers: {
                "Content-Type": "application/json",
                "Api-Token": destination.Config.apiKey
              }
            }
          );
        } catch (err) {
          LOG.error(`Create tag failed error:${err}`);
        }
        //For each tags successfully created the response id is pushed to tagIds
        if (res.status == 201) tagIds.push(res.data.tag.id);
      })
    );
  }

  // Step - 4
  // Merge Created contact with created tags, tagIds array is used
  // Ref - https://developers.activecampaign.com/reference#create-contact-tag
  await Promise.all(
    tagIds.map(async tagId => {
      try {
        res = await Axios.post(
          `${destination.Config.apiUrl}${
            category.mergeTagWithContactUrl
              ? category.mergeTagWithContactUrl
              : ""
          }`,
          {
            contactTag: {
              contact: created_contact.id,
              tag: tagId
            }
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Api-Token": destination.Config.apiKey
            }
          }
        );
      } catch (err) {
        LOG.error(`Merge contact with tags failed error:${err}`);
      }
    })
  );

  return created_contact;
};

const customFieldProcessor = async (
  message,
  category,
  destination,
  createdContact
) => {
  let responseStaging;
  let res;
  // Step - 1
  // Extract the custom field info from the message
  const fieldInfo = get(message.context.traits, "fieldInfo")
    ? get(message.context.traits, "fieldInfo")
    : get(message.traits, "fieldInfo");

  const fieldKeys = Object.keys(fieldInfo);
  // Step - 2
  // Get the existing field data from dest and store it in responseStaging
  // Ref - https://developers.activecampaign.com/reference#retrieve-fields-1
  try {
    res = await Axios.get(
      `${destination.Config.apiUrl}${
        category.fieldEndPoint ? category.fieldEndPoint : ""
      }`,
      {
        headers: {
          "Api-Token": destination.Config.apiKey
        }
      }
    );
    responseStaging = res.status == 200 ? res.data.fields : [];
  } catch (err) {
    LOG.error(`Error while fetching existing fields from dest`);
  }

  // From the responseStaging we store the stored field information in K-V struct iin fieldMap
  // In order for easy comparison and retrieval.
  let fieldMap = {};
  responseStaging.map(field => {
    fieldMap[field.title] = field.id;
  });

  const storedFields = Object.keys(fieldMap);
  const filteredFieldKeys = [];
  fieldKeys.map(fieldKey => {
    //If the field is not present in fieldMap log an error else push it to storedFieldKeys
    if (storedFields.includes(fieldKey)) {
      filteredFieldKeys.push(fieldKey);
    } else {
      LOG.error(`Field ${fieldKey} does not exist in destination, skipping ..`);
    }
  });

  //fieldmap has all the field info in K/V  pair => [title] = id
  //Using the keys we get the value fromMap and fieldinfo

  // Step - 3
  // For each key we create a mapping request for mapping each field to the created contact
  // Ref - https://developers.activecampaign.com/reference#create-fieldvalue
  await Promise.all(
    filteredFieldKeys.map(async key => {
      try {
        let resp = await Axios.post(
          `${destination.Config.apiUrl}${
            category.mergeFieldValueWithContactUrl
              ? category.mergeFieldValueWithContactUrl
              : ""
          }`,
          {
            fieldValue: {
              contact: createdContact.id,
              field: fieldMap[key],
              value: fieldInfo[key]
            }
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Api-Token": destination.Config.apiKey
            }
          }
        );
      } catch (err) {
        LOG.error(`Error While Creating field ${field}`);
      }
    })
  );
};

// The main entry point where the message is processed based on what type of event
// each scenario is resolved by using specific handler function which does
// subsquent processing and transformations and the response is sent to rudder-server
const processEvent = async (message, destination) => {
  if (!message.type) {
    throw new Error("Message Type is not present. Aborting message.");
  }
  const messageType = message.type.toLowerCase();
  let response;
  let category;
  switch (messageType) {
    case EventType.IDENTIFY:
      category = CONFIG_CATEGORIES.IDENTIFY;
      response = await identifyRequestHandler(message, category, destination);
      break;
    case EventType.PAGE:
      category = CONFIG_CATEGORIES.PAGE;
      response = pageRequestHandler(message, category, destination);
      break;
    case EventType.SCREEN:
      category = CONFIG_CATEGORIES.SCREEN;
      response = await screenRequestHandler(message, category, destination);
      break;
    case EventType.TRACK:
      category = CONFIG_CATEGORIES.TRACK;
      response = await trackRequestHandler(message, category, destination);
      break;
    default:
      throw new Error("Message type not supported");
  }
  return response;
};

const process = async event => {
  return await processEvent(event.message, event.destination);
};

exports.process = process;
