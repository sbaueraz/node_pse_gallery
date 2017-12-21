# node_cbr

A web server for browsing and viewing the contents of an Adobe Photoshop Organizer Database.

## Setup

* Install [Node.js](https://nodejs.org/en/), I've tested on 6.10.3 and 8.9.1
* Place the node_cbr files into a directory, preserving directories
* Use npm to install dependencies:
```
npm install
```
* Update config.json to reference the location of your database file:
```
{
   "database_file": "C:\\PSEDatabase\\catalog.pse16db"
}
```
* Launch node:
```
node index.js
```
