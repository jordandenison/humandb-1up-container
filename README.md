# 1up Health FHIR Integration Container

This containers synchronizes data between [1up.health](https://1up.health/) and the HumanDB FHIR server. 
Synchornization can be initiated in the container on startup by setting the environment variables `ONE_UP_SYNC_ON_STARTUP` to `true`. 
Synchornization can can also be initiated by making a HTTP GET to `/sync-data`.
