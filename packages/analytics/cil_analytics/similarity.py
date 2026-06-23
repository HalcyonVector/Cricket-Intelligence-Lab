"""Player similarity: standardize -> PCA -> cosine nearest neighbours."""
from __future__ import annotations
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.metrics.pairwise import cosine_similarity

def similar_players(ids, features: np.ndarray, n_neighbors: int = 10, n_components: int = 6):
    X = StandardScaler().fit_transform(features)
    if X.shape[1] > n_components:
        X = PCA(n_components=n_components, random_state=0).fit_transform(X)
    sim = cosine_similarity(X)
    out = {}
    for i, pid in enumerate(ids):
        order = np.argsort(-sim[i])
        out[pid] = [(ids[j], round(float(sim[i, j]), 3))
                    for j in order if j != i][:n_neighbors]
    return out
