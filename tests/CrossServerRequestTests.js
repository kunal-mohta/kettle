/*!
Kettle Data Source Request Tests

Copyright 2014 Lucendo Development Ltd.

Licensed under the New BSD license. You may not use this file except in
compliance with this License.

You may obtain a copy of the License at
https://github.com/GPII/kettle/LICENSE.txt
*/

"use strict";

var fluid = require("infusion"),
     kettle = require("../kettle.js"),
     jqUnit = fluid.require("jqUnit");
 
kettle.loadTestingSupport();

fluid.registerNamespace("kettle.tests.dataSource");


// These tests set up two Kettle servers, with a dataSource to mediate between them. This is a very
// common use case, where a server provides a modified or proxied view onto another one. This suite
// tests the action of the kettle.dataSource.URL dataSource both reading and writing, as well as the
// "special pathway" which applies limited filtering to any returned payload from a "set" response
// (typically just JSON parsing). It also tests the action of some of the callback wrapping applied
// in the dataSource implementation in order to recontextualise the new stack frame with an existing
// Kettle request.

// These tests could be improved further to test the action of the various failure pathways through 
// the net of promises/dataSources - as well as verifying the proper treatment of the direct payloads
// themselves

// These tests are written in a simplified style avoiding the use of "configs" or any of the dedicated
// server-centred Kettle test boostrap functions - partially because we have two servers to fire up here
// rather than one, and partially to illustrate how this style of testing looks

kettle.tests.endpointReturns = {
    "get": 42,
    "post": {payload : "post return value"},
    "put":  {payload: "put return value"}
};

kettle.tests.endpoint = function (type, request) {
    jqUnit.assertValue("Request is resolvable", request.events.onSuccess);
    var value = kettle.tests.endpointReturns[type];
    // test operation of "request promise" as well as requirement for callback wrapper
    fluid.invokeLater(kettle.wrapCallback(function () {
        fluid.log("ENDPOINT Resolving with value ", value);
        request.requestPromise.resolve(JSON.stringify(value) + "\n");
    }));
};

fluid.defaults("kettle.tests.serverPair.getEndpoint", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.endpoint",
            args: ["get", "{request}"]
        }
    }
});

fluid.defaults("kettle.tests.serverPair.postEndpoint", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.endpoint",
            args: ["post", "{request}"]
        }
    }
});

fluid.defaults("kettle.tests.serverPair.putEndpoint", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.endpoint",
            args: ["put", "{request}"]
        }
    }
});

kettle.tests.relay = function (type, dataSource, requestPromise, writeMethod) {
    var args = writeMethod ? [undefined, undefined, {writeMethod: writeMethod}] : [];
    var response = dataSource[type].apply(null, args);
    response.then(function (value) { // white-box testing for dataSource resolution
        var request = kettle.getCurrentRequest();
        jqUnit.assertValue("Callback to dataSource must be contextualised", request);
        if (type === "set") {
            jqUnit.assertEquals("dataSource set payload must have been parsed", "object", typeof(value));
        }
        requestPromise.resolve(value);
    }, function (error) {
        requestPromise.reject(error);
    });
};

fluid.defaults("kettle.tests.serverPair.getRelay", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.relay",
            args: ["get", "{relayDataSource}", "{request}.requestPromise"]
        }
    }
});

fluid.defaults("kettle.tests.serverPair.postRelay", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.relay",
            args: ["set", "{relayDataSource}", "{request}.requestPromise"]
        }
    }
});

fluid.defaults("kettle.tests.serverPair.putRelay", {
    invokers: {
        handleRequest: {
            funcName: "kettle.tests.relay",
            args: ["set", "{relayDataSource}", "{request}.requestPromise", "PUT"]
        }
    }
});

fluid.defaults("kettle.tests.serverPair", {
    gradeNames: ["fluid.component"],
    components: {
        sourceServer: {
            type: "kettle.server",
            options: {
                port: 8085,
                components: {
                    sourceApp: {
                        type: "kettle.app",
                        options: {
                            requestHandlers: {
                                "kettle.tests.serverPair.getEndpoint": {
                                    route: "/endpoint",
                                    type: "get"
                                },
                                "kettle.tests.serverPair.postEndpoint": {
                                    route: "/endpoint",
                                    type: "post"
                                },
                                "kettle.tests.serverPair.putEndpoint": {
                                    route: "/endpoint",
                                    type: "put"
                                }
                            }
                        }
                    }
                }
            }
        },
        relayServer: {
            type: "kettle.server",
            options: {
                port: 8086,
                components: {
                    relayDataSource: {
                        type: "kettle.dataSource.URL",
                        options: {
                            url: "http://localhost:8085/endpoint",
                            writable: true,
                            writeMethod: "POST"
                        }
                    },
                    relayApp: {
                        type: "kettle.app",
                        options: {
                            requestHandlers: {
                                "kettle.tests.serverPair.getRelay": {
                                    route: "/relay",
                                    type: "get"
                                },
                                "kettle.tests.serverPair.postRelay": {
                                    route: "/relay",
                                    type: "post"
                                },
                                "kettle.tests.serverPair.putRelay": {
                                    route: "/relay",
                                    type: "put"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
});

kettle.tests.testServerPairResponse = function (expected, data) {
    console.log("Received data ", data);
    var parsed = JSON.parse(data);
    jqUnit.assertDeepEq("Expected response from request", expected, parsed);
};

kettle.tests.getServerPairSequence = [
    {
        func: "{getRequest}.send",
        args: [null, {
            path: "/relay"
        }]
    }, {
        event: "{getRequest}.events.onComplete",
        listener: "kettle.tests.testServerPairResponse",
        args: [42, "{arguments}.0"]
    }
];

kettle.tests.postServerPairSequence = [
    {
        func: "{postRequest}.send",
        args: [{setDirectModel: 10}, {setModel: 20}] // TODO: currently ignored
    }, {
        event: "{postRequest}.events.onComplete",
        listener: "kettle.tests.testServerPairResponse",
        args: [{payload: "post return value"}, "{arguments}.0"]
    }
];

kettle.tests.putServerPairSequence = [
    {
        func: "{putRequest}.send",
        args: [{setDirectModel: 10}, {setModel: 20}] // TODO: currently ignored
    }, {
        event: "{putRequest}.events.onComplete",
        listener: "kettle.tests.testServerPairResponse",
        args: [{payload: "put return value"}, "{arguments}.0"]
    }
];

fluid.defaults("kettle.tests.serverPairTester", {
    gradeNames: ["fluid.test.testEnvironment", "kettle.tests.serverPair"],
    components: {
        getRequest: {
            type: "kettle.test.request.http",
            options: {
                port: 8086,
                // path: "/relay", // omit this to test KETTLE-28 by supplying dynamically
                method: "GET"
            }
        },
        postRequest: {
            type: "kettle.test.request.http",
            options: {
                port: 8086,
                path: "/relay",
                method: "POST"
            }
        },
        putRequest: {
            type: "kettle.test.request.http",
            options: {
                port: 8086,
                path: "/relay",
                method: "PUT"
            }
        },
        fixtures: {
            type: "fluid.test.testCaseHolder",
            options: {
                modules: [{
                    name: "Cross server datasource access",
                    tests: [{
                        name: "Access GET request",
                        expect: 3,
                        sequence: kettle.tests.getServerPairSequence
                    }, {
                        name: "Access SET request via POST",
                        expect: 4, // one extra assertion tests the type of a set response payload
                        sequence: kettle.tests.postServerPairSequence
                    }, {
                        name: "Access SET request via PUT",
                        expect: 4, // one extra assertion tests the type of a set response payload
                        sequence: kettle.tests.putServerPairSequence
                    }]
                }]
            }
        }
    }
});

kettle.test.bootstrap("kettle.tests.serverPairTester");