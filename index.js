#!/bin/env node
var config = require('./config');
var express = require('express');
var app = express();
var path = require('path');
var router = express.Router();
var fs = require('fs')
var sharp = require("sharp");

var sqlite3 = require('sqlite3').verbose();
var db = null;
var lastDBAccess = 0;

var extExtract = /(?:\.([^.]+))?$/;

app.use('/js', express.static(__dirname + '/js'));
app.use('/img', express.static(__dirname + '/img'));
app.use('/css', express.static(__dirname + '/css'));
app.use(express.static(__dirname + '/public'));

app.listen(3000);

// all of our routes will be prefixed with /api
app.use('/api', router);

console.logCopy = console.log.bind(console);

console.log = function()
{
    // Timestamp to prepend
    var timestamp = new Date().toJSON();

    if (arguments.length)
    {
        // True array copy so we can call .splice()
        var args = Array.prototype.slice.call(arguments, 0);

        // If there is a format string then... it must
        // be a string
        if (typeof arguments[0] === "string")
        {
            // Prepend timestamp to the (possibly format) string
            args[0] = "%o: " + arguments[0];

            // Insert the timestamp where it has to be
            args.splice(1, 0, timestamp);

            // Log the whole array
            this.logCopy.apply(this, args);
        }
        else
        { 
            // "Normal" log
            this.logCopy(timestamp, args);
        }
    }
};

// Close the DB after 2 minutes of inactivity
setInterval(function() {
    if (db) {
        let now = new Date();

        if (now - lastDBAccess > 2 * 60 * 1000) {
            console.log("Closing connection to database ",config.database_file);
            db.close();
            db = null;
        }
    }
},60 * 1 * 1000); // Every minute

router.get('/getcategories', function(req, res) {
    getDB().all("select distinct e.name as parent, c.name as name, c.id " +
            "from tag_table c, tag_to_media_table d, tag_table e " +
            "where c.id = d.tag_id and e.id = c.parent_id and c.can_have_children = 0 and " + 
            "c.can_tag_media = 1 and e.name not in " + 
            "('history_email_category','history_print_category','rejected_face_ns','Smart Tags','person_ns','Imported Keyword Tags','autotag_category_place','autotag_category_general','autotag_category_ok','autotag_category_worth','autotag_category_event') " +
            "order by (e.name != 'Family')*7+(e.name != 'Friends')*6 + (e.name!='Places')*5+(e.name!='Events'), e.id, c.name", function(err, rows) {
        if (err)
            console.log("getcategories SQL error:", err)

        for (let i = 0;i < rows.length;i ++) {
            if (rows[i].parent == 'event_ns')
                rows[i].parent = 'Events';
            if (rows[i].parent == 'place_ns')
                rows[i].parent = 'Places';
        }

        //console.log("Categories:", rows);
        res.json(rows);
    });
});

router.get('/findpictures', function(req, res) {
    let tags = req.query.tags;

    if (tags.indexOf(';') > -1)
        return;

    // Determine how many tags we have
    for (var tagCnt = 0, index = 0; index != -1; tagCnt++, index = tags.indexOf(",", index + 1));

    let sql = "select a.id as media_id, a.search_date_begin as date, b.name as tag_name, b.parent_id " + 
        "from media_table a, tag_table b, tag_to_media_table c " +
        "where a.id = c.media_id and b.id = c.tag_id and " +
        "b.can_have_children = 0 and b.type_name not in ('autotag', 'history_print', 'pre_content_analysis_group') and " +
        "b.name not like 'zz%' and b.can_tag_media = 1 and " +
        "a.id in ( " +
            "select distinct a.id as media_id " +
            "from media_table a, tag_table b, tag_to_media_table c " +
            "where a.id = c.media_id and b.id = c.tag_id and a.mime_type = 'image/jpeg' and b.id in (" + tags + ") " +
            "group by a.id " +
            "having count(*) = " + tagCnt + ") " +
        "order by a.search_date_begin desc, a.id desc, b.name";

    console.log("Searching for images having tag(s):",tags);
    getDB().all(sql, function(err, rows) {
        let data = {};
        if (err) {
            console.log("findpictures SQL error:", err);
            data.error=err;
        } else {
            console.log("SQL query returned ",rows.length," rows for ",req.query);
            data.Images = [];
            for (let i = 0;i < rows.length;) {
                let image = {};
                image.media_id = rows[i].media_id;
                image.caption = rows[i].date.slice(0,4) + "-" + rows[i].date.slice(4,6) + "-" + rows[i].date.slice(6,8) + ": ";

                for (var a = i; a < rows.length && rows[a].media_id == image.media_id; a ++) {
                    if (a > i)
                        image.caption += ", ";
                    image.caption += rows[a].tag_name;
                }

                i = a;
                data.Images.push(image);
            }

            console.log("Response contains ",data.Images.length);
        }
        res.json(data);
    });
});

router.get('/image', function(req, res) {
    let params = [];
    params.push(req.query.picture);

    getDB().all("select a.full_filepath, b.drive_path_if_builtin from media_table a, volume_table b where a.id=? and a.volume_id=b.id", params, function(err, rows) {
        if (err)
            console.log("/image sql error:", err)
        if (rows && rows.length) {
            let fileName = rows[0].drive_path_if_builtin;
            if (fileName)
                fileName = joinPaths(fileName, rows[0].full_filepath);
            else
                fileName = joinPaths(config.default_drive, rows[0].full_filepath);

            returnFile(fileName,res);      
        }
        else {
            console.log("No image matches:",params);
            returnFile("img/image-missing.jpg", res);
        }
    });
});

router.get('/thumbnail', function(req, res) {
    let params = [];
    params.push(req.query.picture);

    getDB().all("select a.full_filepath, b.drive_path_if_builtin from media_table a, volume_table b where a.id=? and a.volume_id=b.id", params, function(err, rows) {
        if (err)
            console.log("/thumbnail sql error:", err)
        if (rows && rows.length) {
            let fileName = rows[0].drive_path_if_builtin;
            if (fileName)
                fileName = joinPaths(fileName, rows[0].full_filepath);
            else
                fileName = joinPaths(config.default_drive, rows[0].full_filepath);

            returnResizedFile(fileName,req.query.scale,res);      
        }
        else {
            console.log("No image matches:",params);
            returnFile("img/image-missing.jpg", res);
        }
    });
});

function returnFile(image, res) {
    if (!res) return;
    if (!fs.existsSync(image)) {
        console.log("Unable to find: ", image)
        image = "img/image-missing.jpg";
    }

    fs.readFile(image, function(err, data) {
        res.writeHead(200, {'Content-Type': 'image/jpeg'});
        res.end(data); // Send the file data to the browser.
    });
}

function returnResizedFile(image, scale, res) {
    if (!scale || scale < 0)
        scale = 1;
    else if (scale > 4)
        scale = 4;
    scale *= 100;

    if (!fs.existsSync(image)) {
        console.log("Unable to find: ", image)
        image = "img/image-missing.jpg";
    }

    sharp(image,{ failOnError: false }).resize(scale, scale, {kernel: sharp.kernel.nearest}).rotate().toBuffer(function(err, data) {
        if (err) {
            console.log("Unable to resize ", image, "error: ", err);
            returnFile("img/image-missing.jpg");
        } else {
            res.writeHead(200, {'Content-Type': 'image/jpeg'});
            res.end(data); // Send the file data to the browser.
        }
    });
}

function getDB() {
    if (!db) {
        console.log("Creating connection to database ",config.database_file);
        db = new sqlite3.Database(config.database_file, sqlite3.OPEN_READONLY);
    }

    lastDBAccess = new Date();
    return db;
}

function fileNameFilter(filename) {
    if (!config.filename_replace)
        return filename;

    for (let i = 0;i < config.filename_replace.length; i++) {
        if (!config.filename_replace[i].re)
            config.filename_replace[i].re = new RegExp(config.filename_replace[i].replace, 'g');
        filename = filename.replace(config.filename_replace[i].re,config.filename_replace[i].with);
    }

    return filename;
}

function joinPaths(beg, end) {
    if (path.sep == '/') {
        beg = beg.replace(/\\/g, "/");
        end = end.replace(/\\/g, "/");
    } else {
        beg = beg.replace(/\//g, "\\");
        end = end.replace(/\//g, "\\");
    }

    var ret = beg;

    if (!ret.endsWith(path.sep) && !end.startsWith(path.sep))
        ret += path.sep;
    ret += end;

    return fileNameFilter(ret);
}

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

