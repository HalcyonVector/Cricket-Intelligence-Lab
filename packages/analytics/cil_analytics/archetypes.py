"""Player archetypes via K-means; k chosen by silhouette."""
from __future__ import annotations
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

LABELS = ["Anchor", "Aggressor", "Finisher", "Enforcer", "Stock", "Strike"]

def cluster(features: np.ndarray, k_range=range(3, 7), seed=0):
    X = StandardScaler().fit_transform(features)
    best, best_k, best_s = None, None, -1
    for k in k_range:
        km = KMeans(n_clusters=k, random_state=seed, n_init=10).fit(X)
        s = silhouette_score(X, km.labels_)
        if s > best_s:
            best, best_k, best_s = km, k, s
    return best.labels_, best_k, round(float(best_s), 3)
