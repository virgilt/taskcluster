package main

import (
	"io/ioutil"
	"log"

	"github.com/taskcluster/taskcluster/v31/clients/client-shell/codegen"
)

func main() {
	references, err := codegen.LoadReferences()
	if err != nil {
		log.Fatalln("error: failed to load references.json: ", err)
	}

	gen := &codegen.Generator{}

	err = codegen.Generate(references, gen)
	if err != nil {
		log.Fatalln("error: failed to generate services.go: ", err)
	}

	source, err := gen.Format()
	if err != nil {
		log.Fatalln("error: failed to format services.go: ", err)
	}

	err = ioutil.WriteFile("services.go", source, 0664)
	if err != nil {
		log.Fatalln("error: failed to save services.go: ", err)
	}
}
