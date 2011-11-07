// a stream that outputs tar from entries getting added
// when a type="Directory" entry is added, listen to it
// for entries, and add those as well, removing the listener
// once it emits "end".  Close the dir entry itself immediately,
// since it'll always have zero size.
