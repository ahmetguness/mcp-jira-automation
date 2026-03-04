import fs from "fs";

try {
    const data = fs.readFileSync("test-kan-22.log");
    // Looks like it might be utf-16?
    const str = data.toString("utf-16le");
    console.log(str.slice(0, 3000));
    console.log("...");
    console.log(str.slice(-3000));
} catch (e) { console.error(e); }
