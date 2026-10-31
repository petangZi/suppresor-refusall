// Firestore adapter for createGateRouter. Pass an initialized Admin SDK instance.

export function createFirestoreStore(db, {
  keysCollection = 'accessKeys',
  usageCollection = 'gateUsage',
  revokedCollection = 'gateRevoked',
  freeLimit = 15,
} = {}) {
  const usageRef = (deviceId) => db.collection(usageCollection).doc(deviceId);
  const revokedRef = (keyId) => db.collection(revokedCollection).doc(keyId);

  return {
    async getKey(keyId) {
      const snap = await db.collection(keysCollection).doc(keyId).get();
      return snap.exists ? snap.data() : null;
    },

    async consume({ deviceId, idempotencyKey }) {
      return db.runTransaction(async (tx) => {
        const ref = usageRef(deviceId);
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : { uses: 0 };
        const limit = typeof data.limit === 'number' ? data.limit : freeLimit;
        if (idempotencyKey && data.lastKey === idempotencyKey) {
          return { uses: data.uses || 0, limit, allowed: (data.uses || 0) <= limit };
        }
        const uses = (data.uses || 0) + 1;
        tx.set(ref, { uses, limit, lastKey: idempotencyKey || null, updatedAt: new Date() }, { merge: true });
        return { uses, limit, allowed: uses <= limit };
      });
    },

    async heartbeat({ deviceId, keyId }) {
      const [usageSnap, revokedSnap] = await Promise.all([
        usageRef(deviceId).get(),
        keyId ? revokedRef(keyId).get() : Promise.resolve(null),
      ]);
      const uses = usageSnap.exists ? usageSnap.data().uses || 0 : 0;
      const limit = usageSnap.exists && typeof usageSnap.data().limit === 'number'
        ? usageSnap.data().limit
        : freeLimit;
      const revoked = Boolean(revokedSnap && revokedSnap.exists);
      return { allowed: !revoked && uses <= limit, revoked, uses, limit };
    },

    async revoke({ keyId }) {
      if (keyId) await revokedRef(keyId).set({ at: new Date() }, { merge: true });
    },
  };
}
