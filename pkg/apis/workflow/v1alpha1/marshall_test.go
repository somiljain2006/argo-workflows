package v1alpha1

import (
	"encoding/json"
	"testing"

	"github.com/gogo/protobuf/proto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMustUnmarshalClusterWorkflowTemplate(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("The code did not panic but should have")
		} else {
			assert.Equal(t, "no text to unmarshal", r.(string))
		}
	}()
	_ = MustUnmarshalClusterWorkflowTemplate([]byte(""))
	t.Fatalf("MustUnmarshalClusterWorkflowTemplate should have panicked and this part should not have been reached.")
}

func TestParameterWhenSerialization(t *testing.T) {
	p := Parameter{
		Name:  "foo",
		Value: AnyStringPtr("bar"),
		When:  `{{workflow.parameters.mode}} == "advanced"`,
	}
	data, err := json.Marshal(p)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"when":"{{workflow.parameters.mode}} == \"advanced\""`)

	var p2 Parameter
	require.NoError(t, json.Unmarshal(data, &p2))
	assert.Equal(t, p.When, p2.When)
	assert.Equal(t, p.Name, p2.Name)
	assert.Equal(t, p.Value, p2.Value)

	p3 := p.DeepCopy()
	assert.Equal(t, p.When, p3.When)
	assert.Equal(t, p.Name, p3.Name)
	assert.Equal(t, p.Value, p3.Value)
}

func TestParameterProtobufSerialization(t *testing.T) {
	p := &Parameter{
		Name:  "foo",
		Value: AnyStringPtr("bar"),
		When:  `{{workflow.parameters.mode}} == "advanced"`,
	}
	data, err := proto.Marshal(p)
	require.NoError(t, err)

	var p2 Parameter
	err = proto.Unmarshal(data, &p2)
	require.NoError(t, err)
	assert.Equal(t, p.When, p2.When)
	assert.Equal(t, p.Name, p2.Name)
	assert.Equal(t, p.Value, p2.Value)
}


