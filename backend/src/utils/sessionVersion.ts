// Imported fixtures may predate this field; their initial session version is zero.
export const sessionVersionFilter = (version: number) =>
    version === 0
        ? {
              $or: [
                  { sessionVersion: 0 },
                  { sessionVersion: { $exists: false } },
              ],
          }
        : { sessionVersion: version }
