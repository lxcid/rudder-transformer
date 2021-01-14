const axios = jest.genMockFromModule("axios");
const { v4: uuidv4 } = require('uuid');

const urlDirectoryMap = {
  "api.hubapi.com": "hs",
  "zendesk.com": "zendesk",
  "active.campaigns.rudder.com": "active_campaigns"
};

const fs = require("fs");
const path = require("path");
let id = 0;

function getData(url) {
  let directory = "";
  Object.keys(urlDirectoryMap).forEach(key => {
    if (url.includes(key)) {
      directory = urlDirectoryMap[key];
    }
  });
  if (directory) {
    const dataFile = fs.readFileSync(
      path.resolve(__dirname, `./data/${directory}/response.json`)
    );
    const data = JSON.parse(dataFile);
    return data[url];
  }
  return {};
}

const salesForceAuthData = {
  access_token:
    "00D2v000002lXbX!ARcAQJBSGNA1Rq.MbUdtmlREscrN_nO3ckBz6kc4jRQGxqAzNkhT1XZIF0yPqyCQSnezWO3osMw1ewpjToO7q41E9.LvedWY",
  instance_url: "https://ap15.salesforce.com",
  id: "https://login.salesforce.com/id/00D2v000002lXbXEAU/0052v00000ga9WqAAI",
  token_type: "Bearer",
  issued_at: "1582343657644",
  signature: "XRgUHXVBSWhLHZVoVFZby/idWXdAPA5lMW/ZdLMzB8o="
};

function get(url) {
  const mockData = getData(url);
  return new Promise((resolve, reject) => {
    resolve({ data: mockData ,status: 200 });
  });
}

function post(url, payload) {
  const mockData = getData(url);
  if (url.startsWith("https://login.salesforce.com/services/oauth2/token")) {
    return new Promise((resolve, reject) => {
      resolve({ data: salesForceAuthData });
    });
  }
  if (url.includes("https://active.campaigns.rudder.com/api/3/contact/sync")) {
    //resolve with status 201 and response data contains value for contact created
    return new Promise((resolve, reject) => {
      resolve({ data: mockData, status: 201 });
    });
  }
  if (url.includes("https://active.campaigns.rudder.com/api/3/tags")) {
    //resolve with status 201 and the response data contains the created tag
    mockData.tag["tag"] = payload.tag.tag;
    mockData.tag["description"] = payload.tag.description;
    mockData.tag["tagType"] = payload.tag.tagType;
    mockData.tag["id"] = id_generator();
    return new Promise((resolve, reject) => {
      resolve({ data: mockData, status: 201 });
    }); 
  }
  if (url.includes("https://active.campaigns.rudder.com/api/3/contactTags")) {
    //resolve with status 201 and the response data containing the created contact tags
    mockData.contactTag.contact = payload.contactTag.contact;
    mockData.contactTag.id = id_generator();
    mockData.tag = payload.contactTag.tag;
    return new Promise((resolve, reject) => {
      resolve({ data: mockData, status: 201 });
    }); 
  }
  if (url.includes("https://active.campaigns.rudder.com/api/3/fields")) {
    //resolve with status 200 and the response data containing the stored fields
    return new Promise((resolve, reject) => {
      resolve({ data: mockData, status: 200 });
    }); 
  }
  if (url.includes("https://active.campaigns.rudder.com/api/3/fieldValues")){
    //resolve with status 200 and the response data containing the creted Contactfield
    mockData.fieldValue["contact"] = payload.fieldValue.contact;
    mockData.fieldValue["field"] = payload.fieldValue.field;
    mockData.fieldValue["value"] = payload.fieldValue.value;
    mockData.fieldValue["id"] = id_generator();
    return new Promise((resolve, reject) => {
      resolve({ data: mockData, status: 200 });
    }); 
  }
  if(url.includes("https://active.campaigns.rudder.com/api/3/eventTrackingEvents")) {
    //resolve with status 201 and the response data containing the created event
    return new Promise((resolve, reject) => {
      resolve({ data: payload, status: 201 });
    }); 
  }
  return new Promise((resolve, reject) => {
    resolve({ data: mockData });
  });
}

const id_generator = () => {
  id++;
  return id;
}
axios.get = get;
axios.post = post;
module.exports = axios;
