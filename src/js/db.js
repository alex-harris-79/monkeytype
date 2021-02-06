import { loadTags } from "./result-filters";

const db = firebase.firestore();
db.settings({ experimentalForceLongPolling: true });

let dbSnapshot = null;

export function db_updateName(uid, name) {
  db.collection(`users`).doc(uid).set({ name: name }, { merge: true });
}

export function db_getSnapshot() {
  return dbSnapshot;
}

export function db_setSnapshot(newSnapshot) {
  dbSnapshot = newSnapshot;
}

export async function db_getUserSnapshot() {
  let user = firebase.auth().currentUser;
  if (user == null) return false;
  let snap = {
    results: undefined,
    personalBests: {},
    name: undefined,
    tags: [],
    favouriteThemes: [],
    lbMemory: {
      time15: {
        global: null,
        daily: null,
      },
      time60: {
        global: null,
        daily: null,
      },
    },
    globalStats: {
      time: 0,
      started: 0,
      completed: 0,
    },
  };
  try {
    await db
      .collection(`users/${user.uid}/tags/`)
      .get()
      .then((data) => {
        data.docs.forEach((doc) => {
          let tag = doc.data();
          tag.id = doc.id;
          if (tag.personalBests === undefined) {
            tag.personalBests = {};
          }
          snap.tags.push(tag);
        });
        snap.tags = snap.tags.sort((a, b) => {
          if (a.name > b.name) {
            return 1;
          } else if (a.name < b.name) {
            return -1;
          } else {
            return 0;
          }
        });
      })
      .catch((e) => {
        throw e;
      });
    await db
      .collection("users")
      .doc(user.uid)
      .get()
      .then((res) => {
        let data = res.data();
        if (data === undefined) return;
        if (data.personalBests !== undefined) {
          snap.personalBests = data.personalBests;
        }
        snap.name = data.name;
        snap.discordId = data.discordId;
        snap.pairingCode =
          data.discordPairingCode == null ? undefined : data.discordPairingCode;
        snap.config = data.config;
        snap.favouriteThemes =
          data.favouriteThemes === undefined ? [] : data.favouriteThemes;
        snap.globalStats = {
          time: data.timeTyping,
          started: data.startedTests,
          completed: data.completedTests,
        };
        try {
          if (data.lbMemory.time15 !== undefined) {
            snap.lbMemory.time15 = data.lbMemory.time15;
          }
          if (data.lbMemory.time60 !== undefined) {
            snap.lbMemory.time60 = data.lbMemory.time60;
          }
        } catch {}
      })
      .catch((e) => {
        throw e;
      });
    dbSnapshot = snap;
  } catch (e) {
    console.error(e);
  }
  loadTags(dbSnapshot.tags);
  return dbSnapshot;
}

export async function db_getUserResults() {
  let user = firebase.auth().currentUser;
  if (user == null) return false;
  if (dbSnapshot === null) return false;
  if (dbSnapshot.results !== undefined) {
    return true;
  } else {
    try {
      return await db
        .collection(`users/${user.uid}/results/`)
        .orderBy("timestamp", "desc")
        .limit(1000)
        .get()
        .then((data) => {
          dbSnapshot.results = [];
          data.docs.forEach((doc) => {
            let result = doc.data();
            result.id = doc.id;
            dbSnapshot.results.push(result);
          });
          return true;
        })
        .catch((e) => {
          throw e;
        });
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

export async function db_getUserHighestWpm(
  mode,
  mode2,
  punctuation,
  language,
  difficulty
) {
  function cont() {
    let topWpm = 0;
    dbSnapshot.results.forEach((result) => {
      if (
        result.mode == mode &&
        result.mode2 == mode2 &&
        result.punctuation == punctuation &&
        result.language == language &&
        result.difficulty == difficulty
      ) {
        if (result.wpm > topWpm) {
          topWpm = result.wpm;
        }
      }
    });
    return topWpm;
  }

  let retval;
  if (dbSnapshot == null || dbSnapshot.results === undefined) {
    retval = 0;
  } else {
    retval = cont();
  }
  return retval;
}

export async function db_getUserAverageWpm10(
  mode,
  mode2,
  punctuation,
  language,
  difficulty
) {
  function cont() {
    let wpmSum = 0;
    let count = 0;
    let i = 0;
    // You have to use every so you can break out of the loop
    dbSnapshot.results.every((result) => {
      if (
        result.mode == mode &&
        result.mode2 == mode2 &&
        result.punctuation == punctuation &&
        result.language == language &&
        result.difficulty == difficulty
      ) {
        wpmSum += result.wpm;
        count++;
        if (count >= 10) {
          return false;
        }
      }
      return true;
    });
    return Math.round(wpmSum / count);
  }

  let retval = 0;

  if (dbSnapshot == null) return retval;
  var dbSnapshotValid = await db_getUserResults();
  if (dbSnapshotValid === false) {
    return retval;
  }
  retval = cont();
  return retval;
}

export async function db_getLocalPB(
  mode,
  mode2,
  punctuation,
  language,
  difficulty
) {
  function cont() {
    let ret = 0;
    try {
      dbSnapshot.personalBests[mode][mode2].forEach((pb) => {
        if (
          pb.punctuation == punctuation &&
          pb.difficulty == difficulty &&
          pb.language == language
        ) {
          ret = pb.wpm;
        }
      });
      return ret;
    } catch (e) {
      return ret;
    }
  }

  let retval;
  if (dbSnapshot == null) {
    retval = 0;
  } else {
    retval = cont();
  }
  return retval;
}

export async function db_saveLocalPB(
  mode,
  mode2,
  punctuation,
  language,
  difficulty,
  wpm,
  acc,
  raw,
  consistency
) {
  if(mode == "quote") return;
  function cont() {
    try {
      let found = false;
      if (dbSnapshot.personalBests[mode][mode2] === undefined) {
        dbSnapshot.personalBests[mode][mode2] = [];
      }
      dbSnapshot.personalBests[mode][mode2].forEach((pb) => {
        if (
          pb.punctuation == punctuation &&
          pb.difficulty == difficulty &&
          pb.language == language
        ) {
          found = true;
          pb.wpm = wpm;
          pb.acc = acc;
          pb.raw = raw;
          pb.timestamp = Date.now();
          pb.consistency = consistency;
        }
      });
      if (!found) {
        //nothing found
        dbSnapshot.personalBests[mode][mode2].push({
          language: language,
          difficulty: difficulty,
          punctuation: punctuation,
          wpm: wpm,
          acc: acc,
          raw: raw,
          timestamp: Date.now(),
          consistency: consistency,
        });
      }
    } catch (e) {
      //that mode or mode2 is not found
      dbSnapshot.personalBests[mode] = {};
      dbSnapshot.personalBests[mode][mode2] = [
        {
          language: language,
          difficulty: difficulty,
          punctuation: punctuation,
          wpm: wpm,
          acc: acc,
          raw: raw,
          timestamp: Date.now(),
          consistency: consistency,
        },
      ];
    }
  }

  if (dbSnapshot != null) {
    cont();
  }
}

export async function db_getLocalTagPB(
  tagId,
  mode,
  mode2,
  punctuation,
  language,
  difficulty
) {
  function cont() {
    let ret = 0;
    let filteredtag = dbSnapshot.tags.filter((t) => t.id === tagId)[0];
    try {
      filteredtag.personalBests[mode][mode2].forEach((pb) => {
        if (
          pb.punctuation == punctuation &&
          pb.difficulty == difficulty &&
          pb.language == language
        ) {
          ret = pb.wpm;
        }
      });
      return ret;
    } catch (e) {
      return ret;
    }
  }

  let retval;
  if (dbSnapshot == null) {
    retval = 0;
  } else {
    retval = cont();
  }
  return retval;
}

export async function db_saveLocalTagPB(
  tagId,
  mode,
  mode2,
  punctuation,
  language,
  difficulty,
  wpm,
  acc,
  raw,
  consistency
) {
  if(mode == "quote") return;
  function cont() {
    let filteredtag = dbSnapshot.tags.filter((t) => t.id === tagId)[0];
    try {
      let found = false;
      if (filteredtag.personalBests[mode][mode2] === undefined) {
        filteredtag.personalBests[mode][mode2] = [];
      }
      filteredtag.personalBests[mode][mode2].forEach((pb) => {
        if (
          pb.punctuation == punctuation &&
          pb.difficulty == difficulty &&
          pb.language == language
        ) {
          found = true;
          pb.wpm = wpm;
          pb.acc = acc;
          pb.raw = raw;
          pb.timestamp = Date.now();
          pb.consistency = consistency;
        }
      });
      if (!found) {
        //nothing found
        filteredtag.personalBests[mode][mode2].push({
          language: language,
          difficulty: difficulty,
          punctuation: punctuation,
          wpm: wpm,
          acc: acc,
          raw: raw,
          timestamp: Date.now(),
          consistency: consistency,
        });
      }
    } catch (e) {
      //that mode or mode2 is not found
      filteredtag.personalBests[mode] = {};
      filteredtag.personalBests[mode][mode2] = [
        {
          language: language,
          difficulty: difficulty,
          punctuation: punctuation,
          wpm: wpm,
          acc: acc,
          raw: raw,
          timestamp: Date.now(),
          consistency: consistency,
        },
      ];
    }
  }

  if (dbSnapshot != null) {
    cont();
  }
}

// export async function db_getLocalTagPB(tagId) {
//   function cont() {
//     let ret = 0;
//     try {
//       ret = dbSnapshot.tags.filter((t) => t.id === tagId)[0].pb;
//       if (ret == undefined) {
//         ret = 0;
//       }
//       return ret;
//     } catch (e) {
//       return ret;
//     }
//   }

//   let retval;
//   if (dbSnapshot != null) {
//     retval = cont();
//   }
//   return retval;
// }

// export async function db_saveLocalTagPB(tagId, wpm) {
//   function cont() {
//     dbSnapshot.tags.forEach((tag) => {
//       if (tag.id === tagId) {
//         tag.pb = wpm;
//       }
//     });
//   }

//   if (dbSnapshot != null) {
//     cont();
//   }
// }
